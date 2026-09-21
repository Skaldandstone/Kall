const latestAndroidVersion = '1.2.0';
const legacyTesterVersion = '1.1.6';
const playTestUrl = 'https://play.google.com/apps/testing/com.skaldandstone.kall';
const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.skaldandstone.kall';

function versionAtMost(value: string, ceiling: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return false;
  const left = value.split('.').map(Number);
  const right = ceiling.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return true;
}

export async function GET(request: Request) {
  const installed = new URL(request.url).searchParams.get('installed');
  // Builds through 1.1.6 only trust the closed-test URL. They were distributed
  // to that tester cohort, so preserve the link long enough for them to reach
  // 1.2.0. Current and future builds use the public listing.
  const updateUrl = installed && versionAtMost(installed, legacyTesterVersion)
    ? playTestUrl
    : playStoreUrl;

  return Response.json(
    {
      platform: 'android',
      latestVersion: latestAndroidVersion,
      updateUrl,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
