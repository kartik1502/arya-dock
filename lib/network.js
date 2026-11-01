const os = require('os');

/**
 * Find local IPv4 addresses (Wi-Fi, USB Tethering, Ethernet, Bluetooth).
 */
function getNetworkInterfaces() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    if (name.startsWith('docker') || name.startsWith('br-') || name.startsWith('veth') || name.startsWith('virbr')) continue;
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        let type = 'LAN / Ethernet';
        const lower = name.toLowerCase();
        if (lower.startsWith('wl')) {
          type = 'Wi-Fi';
        } else if (lower.includes('usb') || lower.includes('rndis') || /^enp\d+s\d+f\d+u\d+/.test(lower) || lower.startsWith('enx')) {
          type = 'USB Cable Tethering';
        } else if (lower.includes('bt') || lower.includes('pan')) {
          type = 'Bluetooth Network';
        }
        results.push({ name, address: net.address, type });
      }
    }
  }
  return results.sort((a, b) => {
    if (a.type.includes('USB')) return -1;
    if (b.type.includes('USB')) return 1;
    if (a.type.includes('Wi-Fi')) return -1;
    if (b.type.includes('Wi-Fi')) return 1;
    return 0;
  });
}

module.exports = {
  getNetworkInterfaces
};
