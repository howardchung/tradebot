const fs = require('fs');
const request = require('request-promise-native');
const { trade, getPositions, cancel } = require('../utility');

const rebalanceDividends = async (account, token) => {
  const bestDividends = fs.existsSync('./data/stockListDividends.json') ? JSON.parse(fs.readFileSync('./data/stockListDividends.json')) : [];
  const stockList = fs.existsSync('./data/stockList.json') ? JSON.parse(fs.readFileSync('./data/stockList.json')) : [];
  const accData = await request(account, { json: true, headers: {
    Authorization: `Token ${token}`,
  }});
  const portfolioUrl = accData.portfolio;
  const portfolioData = await request(portfolioUrl, { json: true, headers: {
    Authorization: `Token ${token}`,
  }});
  // Current portfolio value = equity
  const equity = Number(portfolioData.equity);
  console.log(equity);
  const pf = await getPositions(token);
  const positions = pf.results;
  console.log('currently holding %s positions', positions.filter(pos => pos.quantity > 0).length);
  const queuedOrders = [];
  // cancel currently open orders
  const orders = await request(`https://api.robinhood.com/orders/`, { json: true, headers: {
    Authorization: `Token ${token}`,
  }});
  for (let order of orders.results) {
    if (order.state === 'queued' || order.state === 'placed') {
      await cancel(token, order.id);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  for (let stock of bestDividends) {
    const currPrice = Number(stock.open);
    // Split equity evenly across best dividends
    const targetQuantity = Math.ceil(equity / bestDividends.length / currPrice);
    // Check current positions
    const currentPosition = positions.find(pos => pos.instrument === stock.instrument);
    const currQuantity = currentPosition ? Number(currentPosition.quantity) : 0;
    const diff = targetQuantity - currQuantity;
    if (Math.abs(diff) > 0) {
      // const price = Number(stock.high).toFixed(2);
      const price = diff > 0 ? (Number(stock.open) * 1.01).toFixed(2) : (Number(currentPosition.average_buy_price) * 0.99).toFixed(2);
      queuedOrders.push({token, account, instrument: stock.instrument, symbol: stock.symbol, quantity: Math.abs(diff), price, side: diff > 0 ? 'buy' : 'sell'});
    }
  }
  // if stock drops out of bestDividends, sell it
  for (let pos of positions) {
    const quantity = Number(pos.quantity);
    if (quantity > 0 && !bestDividends.map(stock => stock.instrument).includes(pos.instrument)) {
      // const price = Number(pos.average_buy_price).toFixed(2);
      const price = 1;
      const symbol = stockList.find(stock => stock.instrument === pos.instrument).symbol;
      queuedOrders.push({token, account, instrument: pos.instrument, symbol, quantity, price, side: 'sell'});
    }
  }
  // sell first, then buy, build list of orders and sort them then execute
  queuedOrders.sort((a, b) => b.side.localeCompare(a.side));
  for (let order of queuedOrders) {
    // we'll run out of money by the end since we're rounding qty up, handle exceptions
    try {
      // sell/buy to meet target
      await trade(order.token, order.account, order.instrument, order.symbol, order.quantity, order.price, order.side);
    } catch(e) {
      console.error(e.message);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
};

module.exports = async function execute(account, token, stockList) {
  const bestDividends = stockList.filter(s => 
    Boolean(s.dividend_yield)
    && s.tradeable
    && Number(s.average_volume) > 500000
    && Number(s.market_cap > 100000000));
  bestDividends.sort((a, b) => Number(b.dividend_yield) - Number(a.dividend_yield));
  fs.writeFileSync('./data/stockListDividends.json', JSON.stringify(bestDividends.slice(0, 100), null, 2));
  await rebalanceDividends(account, token);
  // Run every once in a while
  await new Promise(resolve => setTimeout(resolve, 8 * 60 * 60 * 1000));
}