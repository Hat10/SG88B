export const config = { maxDuration: 10 };

const CLIENT  = 'felles-app-div';
const GQL_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const STOP_ID = 'NSR:StopPlace:58255'; // Rosenhoff, Oslo

export interface Departure {
  line:     string;
  mode:     string;
  dest:     string;
  min:      number;
  realtime: boolean;
}

export default async function handler(_req: any, res: any) {
  try {
    const query = `{
      stopPlace(id: "${STOP_ID}") {
        name
        estimatedCalls(timeRange: 7200, numberOfDepartures: 8) {
          realtime
          expectedDepartureTime
          destinationDisplay { frontText }
          serviceJourney {
            journeyPattern {
              line { publicCode transportMode }
            }
          }
        }
      }
    }`;

    const gqlResp = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    if (!gqlResp.ok) throw new Error(`GraphQL svarte ${gqlResp.status}`);

    const gqlData  = await gqlResp.json();
    const calls    = gqlData.data?.stopPlace?.estimatedCalls ?? [];
    const stopName = (gqlData.data?.stopPlace?.name as string | undefined) ?? 'Rosenhoff';
    const now      = new Date();

    const departures: Departure[] = calls
      .map((c: any) => ({
        line:     c.serviceJourney.journeyPattern.line.publicCode as string,
        mode:     c.serviceJourney.journeyPattern.line.transportMode as string,
        dest:     c.destinationDisplay.frontText as string,
        min:      Math.max(0, Math.round((new Date(c.expectedDepartureTime).getTime() - now.getTime()) / 60000)),
        realtime: c.realtime as boolean,
      }))
      .filter((d: Departure) => d.min >= 0);

    return res.status(200).json({ stopName, departures, updatedAt: now.toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Ukjent feil' });
  }
}
