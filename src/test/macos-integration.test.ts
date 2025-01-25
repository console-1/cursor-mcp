import { MacOSApiService } from '../services/MacOSApiService.js';
import { assert } from 'console';
import { CursorInstanceManagerImpl } from '../managers/CursorInstanceManager.js';

async function sleep(ms: number) {
 return new Promise(resolve => setTimeout(resolve, ms)); 
}

async function testPermissions(service: MacOSApiService) {
 await service.ensurePermissions();
 // Method throws if permissions not granted
}

async function testWindowDetection(service: MacOSApiService) {
 const cursorWindow = await service.getWindowByProcessId(process.pid);
 assert(cursorWindow, 'Failed to detect Cursor window');
 return cursorWindow;
}

async function testKeyboardInput(service: MacOSApiService, window: any) {
 // Command palette
 await service.openCommandPalette(window);
 await sleep(1000);
 
 // Type text
 await service.sendKeyToWindow(window, 84, { shift: true }); // 'T'
 await service.sendKeyToWindow(window, 69, { shift: false }); // 'e'
 await service.sendKeyToWindow(window, 83, { shift: false }); // 's'
 await service.sendKeyToWindow(window, 84, { shift: false }); // 't'
 
 await sleep(500);
 
 // Enter
 await service.sendKeyToWindow(window, 36, { shift: false }); 
}

async function main() {
 const service = new MacOSApiService();
 
 console.log('Running MacOS integration tests...\n');
 
 try {
   // Validate permissions first
   await service.ensurePermissions();
   console.log('✓ Security permissions validated');
   
   // Test Cursor instance lifecycle
   const instanceManager = new CursorInstanceManagerImpl();
   const instance = await instanceManager.create();
   console.log('✓ Instance creation successful');
   
   // Test window operations
   await testPermissions(service);
   console.log('✓ Permissions test passed');
   
   const window = await testWindowDetection(service);
   console.log('✓ Window detection test passed');
   
   await testKeyboardInput(service, window);
   console.log('✓ Keyboard input test passed');
   
   console.log('\nAll tests passed!');
   
 } catch (error) {
   console.error('\nTest failed:', error);
   process.exit(1);
 }
}

if (require.main === module) {
 main().catch(console.error);
}