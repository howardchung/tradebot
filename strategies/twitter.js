const Twitter = require('twitter');
const sentiment = require('sentiment');
const fs = require('fs');
const request = require('request-promise-native');
const { shuffle, trade, getPositions, blacklist } = require('../utility');

const BUFFER_SIZE = 300;
const RECENT_SIZE = 30;
const SCORE_DELTA = 0.05;
const SELL_RATIO = 1.02;

const client = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const analyzeStream = (account, token, filteredList, tokenLookup) => {
  shuffle(filteredList);
  // Twitter API allows watching 400 terms at once
  const slice = filteredList.slice(0, 400);
  const terms = slice.map(stock => stock.simple_name.toLowerCase());
  const track = terms.join(',');
  console.log(track);
  let scoreList = fs.existsSync('./data/scoreList.json') ? JSON.parse(fs.readFileSync('./data/scoreList.json')) : {};
  const stream = client.stream('statuses/filter', { track, language: 'en' });
  stream.on('data', (event) => {
    for (let i = 0; i < terms.length; i++) {
      if (event.text 
      && event.text.indexOf('RT') !== 0 
      && event.text.toLowerCase().indexOf(terms[i]) !== -1) {
        const score = sentiment(event.text).comparative;
        if (score) {
          console.log('[%s] [%s]: %s', terms[i], score, event.text);
        }
        if (!scoreList[terms[i]]) {
          scoreList[terms[i]] = [];
        }
        scoreList[terms[i]].unshift(Number(score));
        scoreList[terms[i]] = scoreList[terms[i]].slice(0, BUFFER_SIZE);
      }
    }
    const scores = Object.keys(scoreList).filter(key => tokenLookup[key]).map(key => {
      const lookup = tokenLookup[key];
      const recent = scoreList[key].slice(0, RECENT_SIZE);
      const score = scoreList[key].reduce((a, b) => a + b) / scoreList[key].length;
      const recentScore = recent.reduce((a, b) => a + b) / recent.length;
      return {
        name: lookup.simple_name,
        instrument: lookup.url, 
        score,
        recentScore,
        delta: recentScore - score,
        n: scoreList[key].length,
      };
    }).filter(score => score.n >= RECENT_SIZE);
    scores.sort((a, b) => b.delta - a.delta);
    // TODO sync this occasionally rather than on every change
    // TODO buy/sell directly here
    fs.writeFileSync('./data/scoreList.tmp', JSON.stringify(scoreList, null, 2));
    fs.writeFileSync('./data/scoreAverages.tmp', JSON.stringify(scores, null, 2));
    fs.renameSync('./data/scoreList.tmp', './data/scoreList.json');
    fs.renameSync('./data/scoreAverages.tmp', './data/scoreAverages.json');
  });
  stream.on('error', (error) => {
    console.error(error);
  });
  // After a minute, restart and watch another set of stocks
  return new Promise(resolve => setTimeout(() => {
    stream.destroy();
    resolve();
  }, 60000));
};

const buy = async (account, token) => {
  const scores = fs.existsSync('./data/scoreAverages.json') ? JSON.parse(fs.readFileSync('./data/scoreAverages.json')) : [];
  const stock = scores[0];
  if (stock && stock.delta > SCORE_DELTA) {
    const accData = await request(account, { json: true, headers: {
      Authorization: `Token ${token}`,
    }});
    const available = accData.buying_power;
    const instrument = await request(stock.instrument, { json: true });
    const symbol = instrument.symbol;
    const quote = await request(`https://api.robinhood.com/quotes/${symbol}/`, { json: true });
    const quantity = Math.floor(available / quote.last_trade_price);
    if (quantity > 0) {
      await trade(token, account, instrument.url, symbol, quantity, quote.last_trade_price, 'buy');
    }
  }
};

const sell = async (account, token) => {
  const pf = await getPositions(token);
  for (let stock of pf.results) {
    if (Number(stock.shares_held_for_sells) <= 0
      // && Number(quote.last_trade_price) > price
      && Number(stock.quantity) > 0) {
      const instrument = await request(stock.instrument, { json: true });
      const symbol = instrument.symbol;
      const price = (Number(stock.average_buy_price) * SELL_RATIO).toFixed(2);
      // const quote = await request(`https://api.robinhood.com/quotes/${symbol}/`, { json: true });
      // const currPrice = quote.last_trade_price;
      await trade(token, account, instrument.url, symbol, stock.quantity, price, 'sell');
    }
  }
};

module.exports = async function execute(account, token, stockList) {
  const filteredList = stockList.filter(stock => 
    stock.simple_name 
    && stock.simple_name.split(' ').length === 1
    && stock.market === 'https://api.robinhood.com/markets/XNAS/'
    && !blacklist.includes(stock.simple_name.toLowerCase()));
  fs.writeFileSync('./stockListFiltered.json', JSON.stringify(filteredList, null, 2));
  const tokenLookup = {};
  filteredList.forEach(stock => {
    tokenLookup[stock.simple_name.toLowerCase()] = stock;
  });
  sell(account, token);
  buy(account, token);
  await analyzeStream(account, token, filteredList, tokenLookup);
}