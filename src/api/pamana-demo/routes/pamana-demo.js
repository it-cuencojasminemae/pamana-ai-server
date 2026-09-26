'use strict';

module.exports = {
  routes: [{
    method: 'GET',
    path: '/pamana-demo/live-vehicles',
    handler: 'pamana-demo.liveVehicles',
    // Authentication remains enabled. Selected authenticated roles receive
    // this permission at bootstrap; Public is never granted it.
    config: { policies: [] },
  }],
};
