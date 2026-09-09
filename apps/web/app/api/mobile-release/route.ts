const latestAndroidVersion = '1.1.5';
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
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    },
  );
}
