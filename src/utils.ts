import fetch from "node-fetch"

type LatLng = { lat: number; lng: number }

/** One sample from the Elevation API */
interface ElevationSample {
    elevation: number
    location: LatLng
}

/** Statistics computed over the route */
interface RouteStats {
    totalAscent: number // in meters
    totalDescent: number // in meters
    maxElevation: number // highest point along route, in meters
    minElevation: number // lowest point, in meters
    maxGrade: number // steepest grade (%) between any two samples
    avgGrade: number // weighted average grade (%) over entire route
}

/**
 * Determine whether the driving route from `origin` to `destination` is flat, hilly, or mountainous.
 *
 * @param origin      – address or "lat,lng"
 * @param destination – address or "lat,lng"
 * @param apiKey      – Google API key with Directions+Elevation enabled
 * @param samples     – how many elevation samples along the path (default 256)
 * @returns           – classification and detailed stats
 */
export async function classifyRouteElevation(
    origin: string,
    destination: string,
    apiKey: string,
    samples: number = 256,
): Promise<{ classification: 'flat' | 'hilly' | 'mountainous'; stats: RouteStats; route: any }> {
    const computeUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes'

    const body = {
        origin: { address: origin },
        destination: { address: destination },
        travelMode: 'DRIVE',
    }

    const computeRes = await fetch(computeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.polyline,routes.travelAdvisory,routes.localizedValues',
        },
        body: JSON.stringify(body),
    })

    const computeData = await computeRes.json()
    if (!computeRes.ok || !computeData.routes?.length) {
        const msg = computeData.error?.message || computeRes.statusText
        throw new Error(`Routes API error: ${msg}`)
    }

    const encodedPath: string = computeData.routes[0].polyline.encodedPolyline

    // 2) Sample elevations along that path
    const elevUrl =
        `https://maps.googleapis.com/maps/api/elevation/json` +
        `?path=enc:${encodedPath}` +
        `&samples=${samples}` +
        `&key=AIzaSyArb1Rb5MAafPQ7Erj_RvN9o5k9jfJQwyQ`
    const elevRes = await fetch(elevUrl)
    const elevData = await elevRes.json()
    if (elevData.status !== 'OK') {
        throw new Error(`Elevation API error: ${elevData.status} ${elevData.error_message || ''}`)
    }
    const samplesArr: ElevationSample[] = elevData.results

    // 3) Compute ascent/descent, grade, min/max elevation
    let totalAscent = 0
    let totalDescent = 0
    let maxElev = -Infinity
    let minElev = Infinity
    let maxGrade = 0
    let weightedGradeSum = 0
    let totalDist = 0

    for (let i = 1; i < samplesArr.length; i++) {
        const prev = samplesArr[i - 1]
        const curr = samplesArr[i]

        const dElev = curr.elevation - prev.elevation
        if (dElev > 0) {
            totalAscent += dElev
        } else {
            totalDescent += -dElev
        }

        maxElev = Math.max(maxElev, curr.elevation)
        minElev = Math.min(minElev, curr.elevation)

        const dist = haversine(prev.location, curr.location) // meters
        if (dist > 0) {
            const grade = (Math.abs(dElev) / dist) * 100 // %
            maxGrade = Math.max(maxGrade, grade)
            weightedGradeSum += grade * dist
            totalDist += dist
        }
    }
    const avgGrade = totalDist > 0 ? weightedGradeSum / totalDist : 0

    let classification: 'flat' | 'hilly' | 'mountainous'
    if (totalAscent < 100 && maxGrade < 3) {
        classification = 'flat'
    } else if (totalAscent < 1000 && maxGrade < 6) {
        classification = 'hilly'
    } else {
        classification = 'mountainous'
    }

    return {
        classification,
        stats: {
            totalAscent,
            totalDescent,
            maxElevation: maxElev,
            minElevation: minElev,
            maxGrade,
            avgGrade,
        },
        route: {
            ...computeData.routes[0].travelAdvisory,
            ...computeData.routes[0].localizedValues,
            // TODO: Fix me!!
            fuelUsed: '21.1l',
        },
    }
}

/** Compute great‐circle distance between two points (in meters) */
function haversine(a: LatLng, b: LatLng): number {
    function toRad(x: number) {
        return (x * Math.PI) / 180
    }
    const R = 6_371_000 // metres
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const phi1 = toRad(a.lat)
    const phi2 = toRad(b.lat)
    const sinDlat = Math.sin(dLat / 2)
    const sinDlng = Math.sin(dLng / 2)
    const under = sinDlat * sinDlat + Math.cos(phi1) * Math.cos(phi2) * sinDlng * sinDlng
    const c = 2 * Math.atan2(Math.sqrt(under), Math.sqrt(1 - under))
    return R * c
}
