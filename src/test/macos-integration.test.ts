import { CursorInstanceManagerImpl } from '../managers/CursorInstanceManager.js';
import { MacOSApiService } from '../services/MacOSApiService.js';

// Replace CommonJS-style main check with ESM equivalent
if (import.meta.url.endsWith(process.argv[1])) {
    // Run tests when executed directly
    runTests().catch((error: unknown) => {
        console.error('Test failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

// Add missing runTests function declaration
async function runTests() {
    // Test implementation
    console.log('Running macOS integration tests...');
    
    try {
        // Check permissions first
        const macosService = new MacOSApiService();
        await macosService.ensurePermissions();

        const cursorManager = new CursorInstanceManagerImpl();
        const instance = await cursorManager.create();
        console.log('Test passed: Instance created successfully');
        
        // Cleanup
        cursorManager.remove(instance.id);
    } catch (error) {
        throw new Error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
} 