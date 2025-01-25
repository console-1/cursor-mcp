import { main } from './index.js';
import { platform, release } from 'os';

function checkMacOSVersion() {
    const minVersion = 20; // macOS 11 Big Sur
    const [major] = release().split('.').map(Number);
    
    if (platform() !== 'darwin' || major < minVersion) {
        throw new Error(`Unsupported macOS version ${release()}. Requires 11.0+`);
    }
}

(async () => {
    try {
        checkMacOSVersion();
        await main();
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
})();
