import {ValhallaProvider} from './valhalla';

const providers = {
    valhalla: ValhallaProvider,
};

function createRoutingProvider(settings) {
    const providerName = settings && settings.provider;
    const Provider = providers[providerName];
    if (!Provider) {
        throw new Error(`Unknown routing provider: ${providerName}`);
    }
    return new Provider(settings);
}

export {createRoutingProvider};
