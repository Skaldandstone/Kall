const latestAndroidVersion = '1.1.6';
const playTestUrl = 'https://play.google.com/apps/testing/com.skaldandstone.kall';

export async function GET() {
  return Response.json(
    {
      platform: 'android',
      latestVersion: latestAndroidVersion,
      updateUrl: playTestUrl,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
