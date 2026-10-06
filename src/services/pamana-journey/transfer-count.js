'use strict';

const { LEG_TYPE } = require('./types');

function countVehicleTransfers(legs = []) {
  return Math.max(0, legs.filter((leg) => leg?.type === LEG_TYPE.TRANSIT).length - 1);
}

module.exports = { countVehicleTransfers };
