require('dotenv').config();
const request = require('request-promise-native');
const { buildStockList } = require('./utility');
const strategy = require('./strategies/dividend');
const username = process.env.ROBINHOOD_USERNAME;
const password = process.env.ROBINHOOD_PASSWORD;
const account = process.env.ROBINHOOD_ACCOUNT;

const main = async () => {
  const auth = await request('https://api.robinhood.com/api-token-auth/', { method: 'POST', body: {username, password}, json: true });
  const { token } = auth;
  const stockList = await buildStockList();
  while (true) {
    await strategy(account, token, stockList);
  }
};

main();