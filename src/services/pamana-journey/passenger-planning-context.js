'use strict';
const { planningContext } = require('./planning-context');
async function passengerPlanningContext(mode, user, strapiInstance = global.strapi) {
  // Authorize before loading preferences or any transport data.
  const context = planningContext(mode);
  let preferences = user?.passenger_profile?.accessibility_preferences;
  if (!preferences && user?.id && strapiInstance?.documents) {
    const profiles = await strapiInstance.documents('api::passenger-profile.passenger-profile').findMany({
      filters: { user: { id: user.id } }, fields: ['accessibility_preferences'], limit: 1,
    });
    preferences = profiles?.[0]?.accessibility_preferences;
  }
  return Object.freeze({ ...context, minimizeWalking: preferences?.minimize_walking === true });
}
module.exports = { passengerPlanningContext };
