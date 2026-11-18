// One shared Yahoo Finance client for every route, with caching.
// Routes use it exactly like before:  const yf = require('../lib/yahoo');
//   yf.quote(t), yf.quoteSummary(t, opts), yf.chart(t, opts), yf.fundamentalsTimeSeries(...)

const YahooFinance = require('yahoo-finance2').default;
const { cached } = require('./cache');

const client = new YahooFinance({
    suppressNotices: ['yahooSurvey', 'ripHistorical'],
    logger: {
        ...console,
        warn: (msg, ...args) => {
            if (!String(msg).includes('Unsupported environment')) console.warn(msg, ...args);
        }
    }
});

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Requests built from "now" change every millisecond, so round dates in the
// cache key: 5 minutes for intraday charts, 1 day for everything else.
function keyFor(method, args, intraday) {
    const step = intraday ? 5 * MIN : 24 * HOUR;
    return method + ':' + JSON.stringify(args, function (k, v) {
        const raw = this[k];
        if (raw instanceof Date) return Math.floor(raw.getTime() / step);
        return v;
    });
}

function ttlFor(method, opts) {
    if (method === 'quote') return 5 * MIN;
    if (method === 'search') return 30 * MIN;
    if (method === 'chart') {
        const iv = String(opts?.interval || '1d');
        return /m$|h$/.test(iv) ? 5 * MIN : 6 * HOUR; // intraday vs daily/monthly
    }
    return 12 * HOUR; // quoteSummary, fundamentalsTimeSeries: change ~quarterly
}

const CACHED_METHODS = new Set(['quote', 'quoteSummary', 'chart', 'fundamentalsTimeSeries', 'search']);

module.exports = new Proxy(client, {
    get(target, prop) {
        const orig = target[prop];
        if (typeof orig !== 'function') return orig;
        if (!CACHED_METHODS.has(prop)) return orig.bind(target);
        return (...args) => {
            const opts = args[1];
            const intraday = prop === 'chart' && /m$|h$/.test(String(opts?.interval || ''));
            return cached(keyFor(prop, args, intraday), ttlFor(prop, opts), () => orig.apply(target, args));
        };
    }
});
