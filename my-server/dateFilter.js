/**
 * Lọc theo preset: month | year | all — so khớp thực tế trên review_time (chuỗi / Date).
 * preset=week (cũ) được coi như month.
 */

/** $match dùng $expr để so sánh theo Date, tránh lệch khi review_time không phải ISO thuần. */
function buildReviewTimeBetweenExpr(fromDate, toDate) {
  if (!fromDate && !toDate) return {};
  const innerAnd = [{ $ne: ['$$rt', null] }];
  if (fromDate) innerAnd.push({ $gte: ['$$rt', fromDate] });
  if (toDate) innerAnd.push({ $lte: ['$$rt', toDate] });
  return {
    $expr: {
      $let: {
        vars: {
          rt: {
            $convert: {
              input: '$review_time',
              to: 'date',
              onError: null,
              onNull: null,
            },
          },
        },
        in: { $and: innerAnd },
      },
    },
  };
}

function getDateFilterFromReq(req) {
  let preset = String(req.query.preset || 'all').toLowerCase();
  if (preset === 'week') preset = 'month';
  if (!['all', 'month', 'year'].includes(preset)) {
    return { match: {}, preset: 'all', label: 'Toàn thời gian', from: null, to: null };
  }
  if (preset === 'all') {
    return { match: {}, preset: 'all', label: 'Toàn thời gian', from: null, to: null };
  }
  const now = new Date();
  const from = new Date(now.getTime());
  if (preset === 'month') from.setMonth(from.getMonth() - 1);
  else if (preset === 'year') from.setFullYear(from.getFullYear() - 1);
  const fromIso = from.toISOString();
  const toIso = now.toISOString();
  const label = preset === 'month' ? '30 ngày qua' : '12 tháng qua';
  return {
    match: buildReviewTimeBetweenExpr(from, now),
    preset,
    label,
    from: fromIso,
    to: toIso,
  };
}

function prependMatch(pipeline, match) {
  if (match && Object.keys(match).length) {
    return [{ $match: match }, ...pipeline];
  }
  return pipeline;
}

const reviewTimeAsDate = {
  $convert: {
    input: '$review_time',
    to: 'date',
    onError: null,
    onNull: null,
  },
};

function buildOverviewTrendPipeline(match, preset) {
  const p = [];
  if (match && Object.keys(match).length) p.push({ $match: match });
  const daily = preset === 'month';
  if (daily) {
    p.push({
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: reviewTimeAsDate,
          },
        },
        total: { $sum: 1 },
        negative: { $sum: '$is_negative_review' },
        avgRating: { $avg: '$rating' },
      },
    });
    p.push({ $match: { _id: { $ne: null } } });
    p.push({ $sort: { _id: 1 } });
    p.push({ $limit: 32 });
    p.push({
      $project: {
        _id: 0,
        label: '$_id',
        total: 1,
        negative: 1,
        avgRating: { $round: ['$avgRating', 2] },
        negRate: {
          $round: [
            { $multiply: [{ $divide: ['$negative', { $max: ['$total', 1] }] }, 100] },
            2,
          ],
        },
      },
    });
  } else {
    p.push({
      $group: {
        _id: { year: '$review_year', month: '$review_month' },
        total: { $sum: 1 },
        negative: { $sum: '$is_negative_review' },
        avgRating: { $avg: '$rating' },
      },
    });
    p.push({ $sort: { '_id.year': 1, '_id.month': 1 } });
    p.push({ $limit: preset === 'year' ? 24 : 36 });
    p.push({
      $project: {
        _id: 0,
        label: {
          $concat: [
            { $toString: { $toInt: '$_id.year' } },
            '/',
            {
              $cond: [
                { $lt: ['$_id.month', 10] },
                { $concat: ['0', { $toString: { $toInt: '$_id.month' } }] },
                { $toString: { $toInt: '$_id.month' } },
              ],
            },
          ],
        },
        total: 1,
        negative: 1,
        avgRating: { $round: ['$avgRating', 2] },
        negRate: {
          $round: [
            { $multiply: [{ $divide: ['$negative', { $max: ['$total', 1] }] }, 100] },
            2,
          ],
        },
      },
    });
  }
  return p;
}

function buildAnalyticsTrendPipeline(match, preset) {
  const p = [];
  if (match && Object.keys(match).length) p.push({ $match: match });
  const daily = preset === 'month';
  if (daily) {
    p.push({
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: reviewTimeAsDate,
          },
        },
        total: { $sum: 1 },
        negative: { $sum: '$is_negative_review' },
        positive: { $sum: { $cond: [{ $eq: ['$sentiment_label', 'positive'] }, 1, 0] } },
        avgRating: { $avg: '$rating' },
      },
    });
    p.push({ $match: { _id: { $ne: null } } });
    p.push({ $sort: { _id: 1 } });
    p.push({ $limit: 32 });
    p.push({
      $project: {
        _id: 0,
        label: '$_id',
        total: 1,
        negative: 1,
        positive: 1,
        avgRating: { $round: ['$avgRating', 2] },
        negRate: {
          $round: [
            { $multiply: [{ $divide: ['$negative', { $max: ['$total', 1] }] }, 100] },
            2,
          ],
        },
        posRate: {
          $round: [
            { $multiply: [{ $divide: ['$positive', { $max: ['$total', 1] }] }, 100] },
            2,
          ],
        },
      },
    });
  } else {
    p.push({
      $group: {
        _id: { year: '$review_year', month: '$review_month' },
        total: { $sum: 1 },
        negative: { $sum: '$is_negative_review' },
        positive: { $sum: { $cond: [{ $eq: ['$sentiment_label', 'positive'] }, 1, 0] } },
        avgRating: { $avg: '$rating' },
      },
    });
    p.push({ $sort: { '_id.year': 1, '_id.month': 1 } });
    p.push({ $limit: preset === 'year' ? 24 : 48 });
    p.push({
      $project: {
        _id: 0,
        label: {
          $concat: [
            { $toString: { $toInt: '$_id.year' } },
            '/',
            {
              $cond: [
                { $lt: ['$_id.month', 10] },
                { $concat: ['0', { $toString: { $toInt: '$_id.month' } }] },
                { $toString: { $toInt: '$_id.month' } },
              ],
            },
          ],
        },
        total: 1,
        negative: 1,
        positive: 1,
        avgRating: { $round: ['$avgRating', 2] },
        negRate: {
          $round: [
            { $multiply: [{ $divide: ['$negative', { $max: ['$total', 1] }] }, 100] },
            2,
          ],
        },
        posRate: {
          $round: [
            { $multiply: [{ $divide: ['$positive', { $max: ['$total', 1] }] }, 100] },
            2,
          ],
        },
      },
    });
  }
  return p;
}

module.exports = {
  getDateFilterFromReq,
  prependMatch,
  buildOverviewTrendPipeline,
  buildAnalyticsTrendPipeline,
  buildReviewTimeBetweenExpr,
};
