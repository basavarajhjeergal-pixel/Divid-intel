const { keywordLabel, riskScore } = require('../routes/news')._test;

test('keyword labels', () => {
    expect(keywordLabel('ONGC posts net loss as oil prices slump')).toBe('negative');
    expect(keywordLabel('TCS declares special dividend after record profit')).toBe('positive');
    expect(keywordLabel('Coal India to hold board meeting on Friday')).toBe('neutral');
});

test('risk score: all negative is high, all positive is low, mix is middle', () => {
    const now = new Date().toISOString();
    const mk = s => ({ signal: s, date: now });
    expect(riskScore([mk('negative'), mk('negative')])).toBe(100);
    expect(riskScore([mk('positive'), mk('positive')])).toBe(0);
    expect(riskScore([mk('negative'), mk('positive')])).toBe(50);
    expect(riskScore([])).toBe(50);
});

test('newer news counts more', () => {
    const old = new Date(Date.now() - 60 * 864e5).toISOString();
    const now = new Date().toISOString();
    expect(riskScore([{ signal: 'negative', date: now }, { signal: 'positive', date: old }])).toBeGreaterThan(80);
});

test('relevance: only headlines about the company count', () => {
    const { companyTerms, isRelevant } = require('../routes/news')._test;
    const ko = companyTerms('KO', 'The Coca-Cola Company');
    expect(isRelevant('Coca-Cola has paid a growing dividend for 64 years', ko)).toBe(true);
    expect(isRelevant('Unusual call option activity in KO stock', ko)).toBe(true);
    expect(isRelevant('Pittston Co-Packers appoints new CEO for growth', ko)).toBe(false);
    expect(isRelevant('Warren Buffett\'s Berkshire hit a record high as Nvidia sank', ko)).toBe(false);
    const ongc = companyTerms('ONGC.NS', 'Oil and Natural Gas Corporation Limited');
    expect(isRelevant('ONGC posts net loss in Q2', ongc)).toBe(true);
    const tcs = companyTerms('TCS.NS', 'Tata Consultancy Services Limited');
    expect(isRelevant('Tata Consultancy declares special dividend', tcs)).toBe(true);
});
