// Helper to read a file as dataURL
export const readFileAsDataURL = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    if (file.size > 2 * 1024 * 1024) { resolve({ fileName: file.name, tooLarge: true, mime: file.type, size: file.size }); return; }
    const reader = new FileReader();
    reader.onload = () => resolve({ fileName: file.name, dataUrl: reader.result, mime: file.type, size: file.size });
    reader.onerror = () => resolve({ fileName: file.name, dataUrl: '', mime: file.type, size: file.size });
    reader.readAsDataURL(file);
  });
};

export const fmt = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const digits = (s) => String(s || '').replace(/\D/g, '');
export const num = (s) => parseInt(digits(s), 10) || 0;
export const emptyTenant = () => ({ name: '', age: '', gender: 'Male', occupation: '', relation: '', pan: '', aadhaar: '', mobile: '', email: '', addr: '' });
