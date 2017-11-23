const request = require('request-promise-native');
const fs = require('fs');

const blacklist = [ 'popular', 'coach', 'now', 'ball', 'time', 'ca', 'team', 'unit', 'guess', 'line', 'ppl', 'icon', 'ea', 'ge', 'amc', 'egov', 'mdp'];

const buildStockList = async () => {
  // wipe stocklist to get latest prices/dividends, takes about 30 minutes to do this
  if (fs.existsSync('./data/stockList.json') && Number(new Date(fs.statSync('./data/stockList.json').mtime)) < (Number(new Date()) - 24 * 60 * 60 * 1000)) {
    fs.unlinkSync('./data/stockList.json');
  }
  if (fs.existsSync('./data/stockList.json')) {
    return JSON.parse(fs.readFileSync('./data/stockList.json'));
  }
  const stockList = [];
  let page = 'https://api.robinhood.com/instruments/';
  while (page) {
    const stocks = await request(page, { json: true });
    for (let stock of stocks.results) {
      console.log(stock.symbol, stock.fundamentals);
      let fundamentals = {};
      try {
        fundamentals = await request(stock.fundamentals, { json: true });
      } catch (e) {
        console.error(e);
      }
      const fullStockData = Object.assign({}, stock, fundamentals);
      stockList.push(fullStockData);
    }
    page = stocks.next;
  }
  fs.writeFileSync('./data/stockList.json', JSON.stringify(stockList, null, 2));
  return stockList;
};

const trade = async (token, account, instrument, symbol, quantity, price, side) => {
  console.log('[%s] %s of %s @ %s (market)', side, quantity, symbol, price);
  // await null;
  await request('https://api.robinhood.com/orders/', {
    method: 'POST',
    body: {
      account,
      instrument,
      symbol,
      type: 'market',
      time_in_force: 'gfd',
      trigger: 'immediate',
      quantity,
      side,
      price,
    }, 
    headers: {
      Authorization: `Token ${token}`,
    },
    json: true,
  });
};

const cancel = async (token, orderId) => {
    console.log('[cancel] %s', orderId);
    await request(`https://api.robinhood.com/orders/${orderId}/cancel/`, {
    method: 'POST',
    body: {}, 
    headers: {
      Authorization: `Token ${token}`,
    },
    json: true,
  });
};

const getPositions = async (token) => {
  return request('https://api.robinhood.com/positions/', { json: true, headers: {Authorization: `Token ${token}`}});
};

/**
 * Shuffles array in place. ES6 version
 * @param {Array} a items The array containing the items.
 */
function shuffle(a) {
    for (let i = a.length; i; i--) {
        let j = Math.floor(Math.random() * i);
        [a[i - 1], a[j]] = [a[j], a[i - 1]];
    }
}

module.exports = {
  blacklist,
  buildStockList,
  trade,
  cancel,
  getPositions,
  shuffle,
};