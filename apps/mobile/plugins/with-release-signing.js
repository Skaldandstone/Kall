const { withAppBuildGradle } = require('@expo/config-plugins');

const marker = '// Kall release signing. Private material is supplied through Gradle properties.';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error('Kall release signing requires the Expo Groovy Android template.');
    }

    let source = modConfig.modResults.contents;
    if (source.includes(marker)) return modConfig;

    const signingProperties = `${marker}
def kallReleaseStoreFile = findProperty('KALL_RELEASE_STORE_FILE')
def kallReleaseStorePassword = findProperty('KALL_RELEASE_STORE_PASSWORD')
def kallReleaseKeyAlias = findProperty('KALL_RELEASE_KEY_ALIAS')
def kallReleaseKeyPassword = findProperty('KALL_RELEASE_KEY_PASSWORD')

`;
    source = source.replace('android {', `${signingProperties}android {`);

    const debugSigning = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
`;
    const releaseSigning = `${debugSigning}        kallRelease {
            if (![kallReleaseStoreFile, kallReleaseStorePassword, kallReleaseKeyAlias, kallReleaseKeyPassword].every { it }) {
                throw new GradleException('Kall release signing properties are required for an alpha APK.')
            }
            storeFile file(kallReleaseStoreFile)
            storePassword kallReleaseStorePassword
            keyAlias kallReleaseKeyAlias
            keyPassword kallReleaseKeyPassword
        }
`;
    if (!source.includes(debugSigning)) {
      throw new Error('Expo Android signing block changed; release signing was not applied.');
    }
    source = source.replace(debugSigning, releaseSigning);

    const debugReleaseSigning = '            signingConfig signingConfigs.debug';
    const releaseBlock = source.indexOf('        release {');
    const debugSigningInRelease = source.indexOf(debugReleaseSigning, releaseBlock);
    if (releaseBlock < 0 || debugSigningInRelease < 0) {
      throw new Error('Expo Android release build block changed; release signing was not applied.');
    }
    source = `${source.slice(0, debugSigningInRelease)}            signingConfig signingConfigs.kallRelease${source.slice(debugSigningInRelease + debugReleaseSigning.length)}`;

    modConfig.modResults.contents = source;
    return modConfig;
  });
};
