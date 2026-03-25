const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27018/my_db';
const COLLECTION = 'reviews_model';

app.use(cors({ origin: '*' }));
app.use(express.json());

mongoose
  .connect(MONGO_URI, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL || 30),
    minPoolSize: Number(process.env.MONGO_MIN_POOL || 5),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 300000),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SELECT_TIMEOUT_MS || 30000),
  })
  .then(async () => {
    console.log(`Connected to MongoDB at ${MONGO_URI}`);
    try {
      await Review.collection.createIndex({ review_time: -1 });
      await Review.collection.createIndex({ district_folder: 1, review_time: -1 });
      await Review.collection.createIndex({ branch_code: 1 });
      await Review.collection.createIndex({ sentiment_label: 1, review_time: -1 });
      await Review.collection.createIndex({ rating_sentiment: 1, review_time: -1 });
      await Review.collection.createIndex({ is_negative_review: 1, has_owner_response: 1 });
    } catch (e) {
      console.error('Index create:', e.message);
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

const schema = new mongoose.Schema({}, { strict: false });
const Review = mongoose.model('Review', schema, COLLECTION);

const {
  getDateFilterFromReq,
  prependMatch,
  buildOverviewTrendPipeline,
  buildAnalyticsTrendPipeline,
  buildReviewTimeBetweenExpr,
} = require('./dateFilter');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

/** sentiment_score chuẩn hóa + bổ trợ theo rating_sentiment để giảm thiên hướng neutral. */
const effectiveSentimentExpr = {
  $let: {
    vars: {
      s: { $ifNull: ['$sentiment_score', 0] },
      rs: { $ifNull: ['$rating_sentiment', 'neutral'] },
    },
    in: {
      $cond: [
        // score mạnh thì giữ score gốc
        { $gte: [{ $abs: '$$s' }, 0.2] },
        '$$s',
        // score yếu thì ưu tiên rating_sentiment
        {
          $switch: {
            branches: [
              { case: { $eq: ['$$rs', 'positive'] }, then: 0.45 },
              { case: { $eq: ['$$rs', 'negative'] }, then: -0.45 },
            ],
            default: '$$s',
          },
        },
      ],
    },
  },
};

const CACHE_TTL_MS = Number(process.env.API_CACHE_TTL_MS || 20000);
const apiCache = new Map();

function cacheGet(key) {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    apiCache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  apiCache.set(key, { ts: Date.now(), data });
}

function getCacheKey(req, tag) {
  const q = new URLSearchParams(req.query).toString();
  return `${tag}:${q}`;
}

// ─── Overview KPIs ───────────────────────────────────────────────────────────
app.get('/api/overview/stats', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'overview-stats');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match } = getDateFilterFromReq(req);
    const [r] = await Review.aggregate(
      prependMatch(
        [
          {
            $group: {
              _id: null,
              totalReviews: { $sum: 1 },
              avgRating: { $avg: '$rating' },
              avgSentiment: { $avg: effectiveSentimentExpr },
              negCount: { $sum: '$is_negative_review' },
              respCount: { $sum: '$has_owner_response' },
              branches: { $addToSet: '$branch_code' },
              districts: { $addToSet: '$district_folder' },
            },
          },
        ],
        match
      )
    );
    if (!r) return res.json({});
    const negRate = round2((r.negCount / r.totalReviews) * 100);
    const healthyScore = round2(
      Math.min(100, Math.max(0, (r.avgRating / 5) * 60 + (1 - negRate / 100) * 40))
    );
    const payload = {
      totalReviews: r.totalReviews,
      avgRating: round2(r.avgRating),
      sentimentScore: round2(r.avgSentiment),
      negativeRate: negRate,
      responseRate: round3((r.respCount / r.totalReviews) * 100),
      healthyScore,
      totalBranches: r.branches.length,
      totalDistricts: r.districts.length,
    };
    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Trend (theo preset: tuần = theo ngày, tháng = theo ngày, năm/tất cả = theo tháng) ─
app.get('/api/overview/trend', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'overview-trend');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match, preset } = getDateFilterFromReq(req);
    const data = await Review.aggregate(buildOverviewTrendPipeline(match, preset));
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rating distribution (1–5★, có lọc preset) ───────────────────────────────
app.get('/api/overview/sentiment-dist', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'overview-rating-dist');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match } = getDateFilterFromReq(req);
    const pipe = prependMatch(
      [
        {
          $group: {
            _id: {
              $min: [
                5,
                { $max: [1, { $round: [{ $ifNull: ['$rating', 0] }, 0] }] },
              ],
            },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $gte: 1, $lte: 5 } } },
        { $sort: { _id: 1 } },
      ],
      match
    );
    const data = await Review.aggregate(pipe);
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Branch Ranking ───────────────────────────────────────────────────────────
app.get('/api/overview/branch-ranking', async (req, res) => {
  try {
    const { match } = getDateFilterFromReq(req);
    const sort = req.query.sort === 'asc' ? 1 : -1;
    const data = await Review.aggregate(
      prependMatch(
        [
          {
            $group: {
              _id: { code: '$branch_code', title: '$title', district: '$district_folder' },
              total: { $sum: 1 },
              negative: { $sum: '$is_negative_review' },
              avgRating: { $avg: '$rating' },
            },
          },
          {
            $project: {
              _id: 0,
              branch_code: '$_id.code',
              title: '$_id.title',
              district: '$_id.district',
              total: 1,
              negative: 1,
              avgRating: { $round: ['$avgRating', 2] },
              negRate: {
                $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2],
              },
            },
          },
          { $sort: { negRate: sort } },
          { $limit: 20 },
        ],
        match
      )
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── District Ranking ─────────────────────────────────────────────────────────
app.get('/api/overview/district-ranking', async (req, res) => {
  try {
    const { match } = getDateFilterFromReq(req);
    const data = await Review.aggregate(
      prependMatch(
        [
          {
            $group: {
              _id: '$district_folder',
              total: { $sum: 1 },
              negative: { $sum: '$is_negative_review' },
              avgRating: { $avg: '$rating' },
              branches: { $addToSet: '$branch_code' },
            },
          },
          {
            $project: {
              _id: 0,
              district: '$_id',
              total: 1,
              negative: 1,
              branchCount: { $size: '$branches' },
              avgRating: { $round: ['$avgRating', 2] },
              negRate: {
                $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2],
              },
            },
          },
          { $sort: { negRate: -1 } },
        ],
        match
      )
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Auto Insights ────────────────────────────────────────────────────────────
app.get('/api/overview/insights', async (req, res) => {
  try {
    const { match } = getDateFilterFromReq(req);
    const [kw] = await Review.aggregate(
      prependMatch(
        [
          {
            $group: {
              _id: null,
              staff: { $sum: { $cond: ['$feat_staff', 1, 0] } },
              waiting: { $sum: { $cond: ['$feat_waiting', 1, 0] } },
              quality: { $sum: { $cond: ['$feat_quality', 1, 0] } },
              ambience: { $sum: { $cond: ['$feat_ambience', 1, 0] } },
              cleanliness: { $sum: { $cond: ['$feat_cleanliness', 1, 0] } },
              totalNeg: { $sum: '$is_negative_review' },
              total: { $sum: 1 },
            },
          },
        ],
        match
      )
    );
    if (!kw || !kw.total) return res.json([]);

    const topKw = Object.entries({
      'Nhân viên': kw.staff,
      'Thời gian chờ': kw.waiting,
      'Chất lượng đồ uống': kw.quality,
      'Không gian': kw.ambience,
      'Vệ sinh': kw.cleanliness,
    }).sort((a, b) => b[1] - a[1]);

    const topDistrict = await Review.aggregate(
      prependMatch(
        [
          { $group: { _id: '$district_folder', neg: { $sum: '$is_negative_review' }, tot: { $sum: 1 } } },
          { $project: { negRate: { $divide: ['$neg', '$tot'] } } },
          { $sort: { negRate: -1 } },
          { $limit: 1 },
        ],
        match
      )
    );

    const negMatch = { ...match, is_negative_review: 1 };
    const [topHour] = await Review.aggregate([
      { $match: negMatch },
      { $group: { _id: '$review_hour', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);

    const negPct = round2((kw.totalNeg / kw.total) * 100);
    const insights = [
      `${negPct}% tổng đánh giá có nội dung tiêu cực.`,
      topKw[0][1] > 0
        ? `Vấn đề phàn nàn nhiều nhất: ${topKw[0][0]} (${topKw[0][1]} lượt).`
        : 'Chưa có tín hiệu từ khóa phàn nàn trong khoảng thời gian này.',
      topDistrict[0]
        ? `Quận rủi ro cao nhất: ${topDistrict[0]._id} (${round2(topDistrict[0].negRate * 100)}% tiêu cực).`
        : '',
      topHour
        ? `Khung giờ ${topHour._id}:00 nhận nhiều đánh giá tiêu cực nhất.`
        : '',
    ].filter(Boolean);

    res.json(insights);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Dashboard bundle (1 request — giảm chờ trên frontend) ───────────────────
app.get('/api/overview/dashboard', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'overview-dashboard');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match, preset, label, from, to } = getDateFilterFromReq(req);
    const sort = req.query.sort === 'asc' ? 1 : -1;

    const statsPipeline = prependMatch(
      [
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            avgRating: { $avg: '$rating' },
            avgSentiment: { $avg: effectiveSentimentExpr },
            negCount: { $sum: '$is_negative_review' },
            respCount: { $sum: '$has_owner_response' },
            branches: { $addToSet: '$branch_code' },
            districts: { $addToSet: '$district_folder' },
          },
        },
      ],
      match
    );

    const branchPipe = prependMatch(
      [
        {
          $group: {
            _id: { code: '$branch_code', title: '$title', district: '$district_folder' },
            total: { $sum: 1 },
            negative: { $sum: '$is_negative_review' },
            avgRating: { $avg: '$rating' },
          },
        },
        {
          $project: {
            _id: 0,
            branch_code: '$_id.code',
            title: '$_id.title',
            district: '$_id.district',
            total: 1,
            negative: 1,
            avgRating: { $round: ['$avgRating', 2] },
            negRate: {
              $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2],
            },
          },
        },
        { $sort: { negRate: sort } },
        { $limit: 20 },
      ],
      match
    );

    const districtPipe = prependMatch(
      [
        {
          $group: {
            _id: '$district_folder',
            total: { $sum: 1 },
            negative: { $sum: '$is_negative_review' },
            avgRating: { $avg: '$rating' },
            branches: { $addToSet: '$branch_code' },
          },
        },
        {
          $project: {
            _id: 0,
            district: '$_id',
            total: 1,
            negative: 1,
            branchCount: { $size: '$branches' },
            avgRating: { $round: ['$avgRating', 2] },
            negRate: {
              $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2],
            },
          },
        },
        { $sort: { negRate: -1 } },
      ],
      match
    );

    const districtRiskPipe = prependMatch(
      [
        {
          $group: {
            _id: '$district_folder',
            total: { $sum: 1 },
            negative: { $sum: '$is_negative_review' },
            avgRating: { $avg: '$rating' },
            branches: { $addToSet: '$branch_code' },
          },
        },
        {
          $project: {
            _id: 0,
            district: '$_id',
            total: 1,
            negative: 1,
            branchCount: { $size: '$branches' },
            avgRating: { $round: ['$avgRating', 2] },
            negRate: {
              $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2],
            },
          },
        },
        { $sort: { negRate: -1 } },
        { $limit: 10 },
      ],
      match
    );

    const ratingDistPipe = prependMatch(
      [
        {
          $group: {
            _id: {
              $min: [
                5,
                { $max: [1, { $round: [{ $ifNull: ['$rating', 0] }, 0] }] },
              ],
            },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $gte: 1, $lte: 5 } } },
        { $sort: { _id: 1 } },
      ],
      match
    );

    const trendPipe = buildOverviewTrendPipeline(match, preset);

    const [
      statsRows,
      trend,
      ratingDist,
      branchRanking,
      districtRanking,
      districtRisk,
    ] = await Promise.all([
      Review.aggregate(statsPipeline),
      Review.aggregate(trendPipe),
      Review.aggregate(ratingDistPipe),
      Review.aggregate(branchPipe),
      Review.aggregate(districtPipe),
      Review.aggregate(districtRiskPipe),
    ]);

    const r = statsRows[0];
    let stats = {};
    if (r && r.totalReviews) {
      const negRate = round2((r.negCount / r.totalReviews) * 100);
      const healthyScore = round2(
        Math.min(100, Math.max(0, (r.avgRating / 5) * 60 + (1 - negRate / 100) * 40))
      );
      stats = {
        totalReviews: r.totalReviews,
        avgRating: round2(r.avgRating),
        sentimentScore: round2(r.avgSentiment),
        negativeRate: negRate,
        responseRate: round3((r.respCount / r.totalReviews) * 100),
        healthyScore,
        totalBranches: r.branches.length,
        totalDistricts: r.districts.length,
      };
    }

    const [kw] = await Review.aggregate(
      prependMatch(
        [
          {
            $group: {
              _id: null,
              staff: { $sum: { $cond: ['$feat_staff', 1, 0] } },
              waiting: { $sum: { $cond: ['$feat_waiting', 1, 0] } },
              quality: { $sum: { $cond: ['$feat_quality', 1, 0] } },
              ambience: { $sum: { $cond: ['$feat_ambience', 1, 0] } },
              cleanliness: { $sum: { $cond: ['$feat_cleanliness', 1, 0] } },
              totalNeg: { $sum: '$is_negative_review' },
              total: { $sum: 1 },
            },
          },
        ],
        match
      )
    );

    let insights = [];
    if (kw && kw.total) {
      const topKw = Object.entries({
        'Nhân viên': kw.staff,
        'Thời gian chờ': kw.waiting,
        'Chất lượng đồ uống': kw.quality,
        'Không gian': kw.ambience,
        'Vệ sinh': kw.cleanliness,
      }).sort((a, b) => b[1] - a[1]);
      const topDistrict = await Review.aggregate(
        prependMatch(
          [
            { $group: { _id: '$district_folder', neg: { $sum: '$is_negative_review' }, tot: { $sum: 1 } } },
            { $project: { negRate: { $divide: ['$neg', '$tot'] } } },
            { $sort: { negRate: -1 } },
            { $limit: 1 },
          ],
          match
        )
      );
      const negMatch = { ...match, is_negative_review: 1 };
      const [topHour] = await Review.aggregate([
        { $match: negMatch },
        { $group: { _id: '$review_hour', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ]);
      const negPct = round2((kw.totalNeg / kw.total) * 100);
      insights = [
        `${negPct}% tổng đánh giá có nội dung tiêu cực.`,
        topKw[0][1] > 0
          ? `Vấn đề phàn nàn nhiều nhất: ${topKw[0][0]} (${topKw[0][1]} lượt).`
          : 'Chưa có tín hiệu từ khóa phàn nàn trong khoảng thời gian này.',
        topDistrict[0]
          ? `Quận rủi ro cao nhất: ${topDistrict[0]._id} (${round2(topDistrict[0].negRate * 100)}% tiêu cực).`
          : '',
        topHour
          ? `Khung giờ ${topHour._id}:00 nhận nhiều đánh giá tiêu cực nhất.`
          : '',
      ].filter(Boolean);
    }

    const payload = {
      stats,
      trend,
      ratingDist,
      branchRanking,
      districtRanking,
      districtRisk,
      insights,
      period: { preset, label, from, to },
    };
    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Live Tracking Reviews ────────────────────────────────────────────────────
app.get('/api/reviews', async (req, res) => {
  try {
    const {
      sentiment,
      rating,
      district,
      branch,
      q,
      page = 1,
      limit = 50,
      startDate,
      endDate,
    } = req.query;

    const match = {};
    if (sentiment && sentiment !== 'all') {
      if (sentiment === 'negative') {
        // Lấy tất cả: cờ is_negative_review, nhãn chữ tiêu cực, hoặc nhãn sao tiêu cực
        match.$or = [
          { is_negative_review: 1 },
          { sentiment_label: 'negative' },
          { rating_sentiment: 'negative' },
        ];
      } else if (sentiment === 'positive') {
        // Ưu tiên nhãn tích cực và chắc chắn không phải tiêu cực (is_negative_review=0)
        match.is_negative_review = 0;
        match.$or = [
          { sentiment_label: 'positive' },
          { rating_sentiment: 'positive' },
        ];
      } else {
        match.sentiment_label = sentiment;
        match.is_negative_review = 0;
      }
    }
    if (rating && Number(rating) > 0) {
      // Lọc theo "sao hiển thị" (Math.round): 5★ = [4.5, 5], 4★ = [3.5, 4.5), ...
      const r = Number(rating);
      const min = Math.max(0, r - 0.5);
      const max = r === 5 ? 5 : r + 0.5;
      match.rating = r === 5 ? { $gte: min, $lte: max } : { $gte: min, $lt: max };
    }
    if (district && district !== 'all') match.district_folder = district;
    if (branch && branch !== 'all') match.branch_code = branch;
    if (q) match.review_text = { $regex: q, $options: 'i' };
    if (startDate || endDate) {
      const fromD = startDate ? new Date(`${startDate}T00:00:00.000Z`) : null;
      const toD = endDate ? new Date(`${endDate}T23:59:59.999Z`) : null;
      Object.assign(match, buildReviewTimeBetweenExpr(fromD, toD));
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [docs, total] = await Promise.all([
      Review.find(match, {
        name: 1, review_text: 1, texttranslated: 1, rating: 1,
        sentiment_label: 1, sentiment_score: 1, rating_sentiment: 1, is_negative_review: 1,
        has_owner_response: 1, owner_response: 1,
        district_folder: 1, branch_code: 1, title: 1,
        review_time: 1, review_hour: 1, review_dayofweek: 1,
        feat_staff: 1, feat_waiting: 1, feat_quality: 1,
        feat_ambience: 1, feat_cleanliness: 1,
        rating_text_mismatch_flag: 1,
      })
        .sort({ review_time: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Review.countDocuments(match),
    ]);

    res.json({ data: docs, total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Filter Options ───────────────────────────────────────────────────────────
app.get('/api/reviews/filters', async (req, res) => {
  try {
    const [districts, branches] = await Promise.all([
      Review.distinct('district_folder'),
      Review.aggregate([
        { $group: { _id: '$branch_code', title: { $first: '$title' }, district: { $first: '$district_folder' } } },
        { $sort: { '_id': 1 } },
      ]),
    ]);
    res.json({ districts: districts.filter(Boolean).sort(), branches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Analytics: Trend ─────────────────────────────────────────────────────────
app.get('/api/analytics/trend', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'analytics-trend');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match, preset } = getDateFilterFromReq(req);
    const data = await Review.aggregate(buildAnalyticsTrendPipeline(match, preset));
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Analytics: Keywords ──────────────────────────────────────────────────────
app.get('/api/analytics/keywords', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'analytics-keywords');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match } = getDateFilterFromReq(req);
    const [r] = await Review.aggregate(
      prependMatch(
        [
          {
            $group: {
              _id: null,
              staff: { $sum: { $cond: ['$feat_staff', 1, 0] } },
              waiting: { $sum: { $cond: ['$feat_waiting', 1, 0] } },
              quality: { $sum: { $cond: ['$feat_quality', 1, 0] } },
              ambience: { $sum: { $cond: ['$feat_ambience', 1, 0] } },
              cleanliness: { $sum: { $cond: ['$feat_cleanliness', 1, 0] } },
            },
          },
        ],
        match
      )
    );
    if (!r) return res.json([]);
    const payload = [
      { label: 'Nhân viên', count: r.staff },
      { label: 'Thời gian chờ', count: r.waiting },
      { label: 'Chất lượng ĐU', count: r.quality },
      { label: 'Không gian', count: r.ambience },
      { label: 'Vệ sinh', count: r.cleanliness },
    ].sort((a, b) => b.count - a.count);
    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Analytics: Hour x Day Heatmap ───────────────────────────────────────────
app.get('/api/analytics/heatmap', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'analytics-heatmap');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match } = getDateFilterFromReq(req);
    const firstMatch = { ...match, is_negative_review: 1 };
    const data = await Review.aggregate([
      { $match: firstMatch },
      {
        $group: {
          _id: { hour: '$review_hour', day: '$review_dayofweek' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          hour: '$_id.hour',
          day: '$_id.day',
          count: 1,
        },
      },
    ]);
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Analytics: Shift Distribution ───────────────────────────────────────────
app.get('/api/analytics/shift', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'analytics-shift');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match } = getDateFilterFromReq(req);
    const data = await Review.aggregate(
      prependMatch(
        [
          {
            $addFields: {
              shift: {
                $switch: {
                  branches: [
                    { case: { $and: [{ $gte: ['$review_hour', 6] }, { $lt: ['$review_hour', 12] }] }, then: 'Sáng (6-12h)' },
                    { case: { $and: [{ $gte: ['$review_hour', 12] }, { $lt: ['$review_hour', 18] }] }, then: 'Chiều (12-18h)' },
                    { case: { $and: [{ $gte: ['$review_hour', 18] }, { $lt: ['$review_hour', 22] }] }, then: 'Tối (18-22h)' },
                  ],
                  default: 'Đêm (22-6h)',
                },
              },
            },
          },
          {
            $group: {
              _id: '$shift',
              total: { $sum: 1 },
              negative: { $sum: '$is_negative_review' },
            },
          },
          { $sort: { _id: 1 } },
        ],
        match
      )
    );
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Analytics: District Risk ─────────────────────────────────────────────────
app.get('/api/analytics/district-risk', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req, 'analytics-district-risk');
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const { match } = getDateFilterFromReq(req);
    const data = await Review.aggregate(
      prependMatch(
        [
          {
            $group: {
              _id: '$district_folder',
              total: { $sum: 1 },
              negative: { $sum: '$is_negative_review' },
              avgRating: { $avg: '$rating' },
              branches: { $addToSet: '$branch_code' },
            },
          },
          {
            $project: {
              _id: 0,
              district: '$_id',
              total: 1,
              negative: 1,
              branchCount: { $size: '$branches' },
              avgRating: { $round: ['$avgRating', 2] },
              negRate: { $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2] },
            },
          },
          { $sort: { negRate: -1 } },
          { $limit: 15 },
        ],
        match
      )
    );
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Alerts ───────────────────────────────────────────────────────────────────
app.get('/api/alerts', async (req, res) => {
  try {
    const { level, district } = req.query;

    const criticalMatch = { is_negative_review: 1, has_owner_response: 0 };
    if (district && district !== 'all') criticalMatch.district_folder = district;
    if (level === 'warning') {
      criticalMatch.rating = { $in: [2, 3] };
    } else if (level === 'critical') {
      criticalMatch.rating = 1;
    }

    const [critical, unresponded, [distStats]] = await Promise.all([
      Review.find(criticalMatch, {
        name: 1, review_text: 1, rating: 1, sentiment_label: 1,
        district_folder: 1, title: 1, branch_code: 1,
        review_time: 1, feat_staff: 1, feat_waiting: 1,
        feat_quality: 1, feat_ambience: 1, feat_cleanliness: 1,
        rating_text_mismatch_flag: 1,
      })
        .sort({ review_time: -1 })
        .limit(100)
        .lean(),
      Review.countDocuments({ is_negative_review: 1, has_owner_response: 0 }),
      Review.aggregate([
        { $match: { is_negative_review: 1, has_owner_response: 0 } },
        {
          $group: {
            _id: '$district_folder',
            count: { $sum: 1 },
            avgRating: { $avg: '$rating' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $group: { _id: null, districts: { $push: { district: '$_id', count: '$count' } } } },
      ]),
    ]);

    res.json({
      alerts: critical,
      totalUnresponded: unresponded,
      topDistricts: distStats?.districts || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Map Data ─────────────────────────────────────────────────────────────────
app.get('/api/map/data', async (req, res) => {
  try {
    const data = await Review.aggregate([
      {
        $group: {
          _id: '$district_folder',
          total: { $sum: 1 },
          negative: { $sum: '$is_negative_review' },
          avgRating: { $avg: '$rating' },
          avgLat: { $avg: '$location/lat' },
          avgLng: { $avg: '$location/lng' },
          branches: { $addToSet: '$branch_code' },
        },
      },
      {
        $project: {
          _id: 0,
          district: '$_id',
          total: 1,
          negative: 1,
          branchCount: { $size: '$branches' },
          avgRating: { $round: ['$avgRating', 2] },
          avgLat: { $round: ['$avgLat', 6] },
          avgLng: { $round: ['$avgLng', 6] },
          negRate: { $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2] },
        },
      },
      { $sort: { district: 1 } },
    ]);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Branch Detail for Map ────────────────────────────────────────────────────
app.get('/api/map/branches', async (req, res) => {
  try {
    const data = await Review.aggregate([
      {
        $group: {
          _id: '$branch_code',
          title: { $first: '$title' },
          district: { $first: '$district_folder' },
          lat: { $first: '$location/lat' },
          lng: { $first: '$location/lng' },
          total: { $sum: 1 },
          negative: { $sum: '$is_negative_review' },
          avgRating: { $avg: '$rating' },
          totalscore: { $first: '$totalscore' },
        },
      },
      {
        $project: {
          _id: 0,
          branch_code: '$_id',
          title: 1, district: 1, lat: 1, lng: 1,
          total: 1, negative: 1, totalscore: 1,
          avgRating: { $round: ['$avgRating', 2] },
          negRate: { $round: [{ $multiply: [{ $divide: ['$negative', '$total'] }, 100] }, 2] },
        },
      },
      { $match: { lat: { $ne: null }, lng: { $ne: null } } },
    ]);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT);
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 300000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 305000);
