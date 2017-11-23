const acquisitionStream = (client) => {
  const stream2 = client.stream('statuses/filter', { track: 'acquire,acquisition,acquiring,acquires', language: 'en' });
  stream2.on('data', (event) => {
    console.log(event.text);
  });
};
