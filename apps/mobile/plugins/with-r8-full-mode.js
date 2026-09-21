const { withGradleProperties } = require('@expo/config-plugins');

const KEY = 'android.enableR8.fullMode';

module.exports = function withR8FullMode(config) {
  return withGradleProperties(config, (modConfig) => {
    const existing = modConfig.modResults.find((item) => item.type === 'property' && item.key === KEY);
    if (existing) {
      existing.value = 'true';
    } else {
      modConfig.modResults.push({ type: 'property', key: KEY, value: 'true' });
    }
    return modConfig;
  });
};
