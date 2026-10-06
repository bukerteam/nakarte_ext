import {ValhallaProvider} from './valhalla';

const providers = new Map();

function registerRoutingProvider(providerName, Provider) {
    providers.set(providerName, Provider);
}

registerRoutingProvider('valhalla', ValhallaProvider);

/**
 * Routing provider contract:
 *
 *   route({points, profile, options, signal}) => Promise<{
 *       geometry: {type: 'LineString', coordinates: Array<[lng, lat]>},
 *       distance: number, // meters
 *       duration: number, // seconds
 *   }>
 *
 * - `points`: ordered array of {lat, lng}, at least two.
 * - `profile`: one of the ids from ./profiles.
 * - `options`: engine-neutral routing options; adapters translate the ones they support.
 * - `signal`: optional AbortSignal; providers must pass it to their request.
 *
 * Adapters own all engine-specific request/response handling and must return only the
 * neutral route data above. The returned route is engine-neutral and can be stored as is.
 */
function createRoutingProvider(settings) {
    const providerName = settings && settings.provider;
    const Provider = providers.get(providerName);
    if (!Provider) {
        throw new Error(`Unknown routing provider: ${providerName}`);
    }
    return new Provider(settings);
}

export {createRoutingProvider, registerRoutingProvider};
