// ==UserScript==
// @name         WPlace Image Processor
// @namespace    http://tampermonkey.net/
// @version      2025-09-16.1
// @description  Image processing and color management for WPlace AutoBot
// @author       Wbot
// @match        https://wplace.live/*
// @grant        none
// ==/UserScript==

/**
 * ImageProcessor - Handles image loading, processing, color conversion, and dithering for WPlace AutoBot
 * Extracted from Auto-Image.js for better modularity and reusabilit
 */
class ImageProcessor {
  constructor(imageSrc = null) {
    this.imageSrc = imageSrc;
    this.img = null;
    this.canvas = null;
    this.ctx = null;
    
    // Dithering buffers
    this._ditherWorkBuf = null;
    this._ditherEligibleBuf = null;
    
    // Color cache for performance optimization
    this._colorCache = new Map();
    this._labCache = new Map();
    this._hsvCache = new Map();
    this._hslCache = new Map();
    this._xyzCache = new Map();
    this._luvCache = new Map();
    this._yuvCache = new Map();
    this._oklabCache = new Map();
    this._lchCache = new Map();
    
    // Configuration constants
    this.TRANSPARENCY_THRESHOLD = 128;
    this.WHITE_THRESHOLD = 230;
    this.COLOR_CACHE_LIMIT = 15000;
  }

  /**
   * Load image from source
   * @returns {Promise<void>}
   */
  async load() {
    if (!this.imageSrc) {
      throw new Error('No image source provided');
    }

    return new Promise((resolve, reject) => {
      this.img = new Image();
      this.img.crossOrigin = 'anonymous';
      this.img.onload = () => {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = this.img.width;
        this.canvas.height = this.img.height;
        this.ctx.drawImage(this.img, 0, 0);
        resolve();
      };
      this.img.onerror = reject;
      this.img.src = this.imageSrc;
    });
  }

  /**
   * Get image dimensions
   * @returns {{width: number, height: number}}
   */
  getDimensions() {
    if (!this.canvas) {
      throw new Error('Image not loaded. Call load() first.');
    }
    return {
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  /**
   * Get pixel data from the image
   * @returns {Uint8ClampedArray} RGBA pixel data
   */
  getPixelData() {
    if (!this.ctx) {
      throw new Error('Image not loaded. Call load() first.');
    }
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
  }

  /**
   * Resize image to new dimensions
   * @param {number} newWidth - Target width
   * @param {number} newHeight - Target height
   * @returns {Uint8ClampedArray} Resized image data
   */
  resize(newWidth, newHeight) {
    if (!this.canvas || !this.ctx) {
      throw new Error('Image not loaded. Call load() first.');
    }

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    tempCanvas.width = newWidth;
    tempCanvas.height = newHeight;

    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(this.canvas, 0, 0, newWidth, newHeight);

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(tempCanvas, 0, 0);

    return this.ctx.getImageData(0, 0, newWidth, newHeight).data;
  }

  /**
   * Generate preview with resizing
   * @param {number} width - Preview width
   * @param {number} height - Preview height
   * @returns {string} Base64 data URL of the preview
   */
  generatePreview(width, height) {
    if (!this.canvas) {
      throw new Error('Image not loaded. Call load() first.');
    }

    const previewCanvas = document.createElement('canvas');
    const previewCtx = previewCanvas.getContext('2d');
    previewCanvas.width = width;
    previewCanvas.height = height;

    previewCtx.imageSmoothingEnabled = false;
    previewCtx.drawImage(this.canvas, 0, 0, width, height);

    return previewCanvas.toDataURL();
  }

  // =============================================
  // COLOR PROCESSING METHODS
  // =============================================

  /**
   * Convert RGB to LAB color space
   * @param {number} r - Red value (0-255)
   * @param {number} g - Green value (0-255)
   * @param {number} b - Blue value (0-255)
   * @returns {number[]} LAB values [L, a, b]
   * @private
   */
  _rgbToLab(r, g, b) {
    // Normalize RGB values
    let x = r / 255.0;
    let y = g / 255.0;
    let z = b / 255.0;

    // Apply gamma correction
    x = x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92;
    y = y > 0.04045 ? Math.pow((y + 0.055) / 1.055, 2.4) : y / 12.92;
    z = z > 0.04045 ? Math.pow((z + 0.055) / 1.055, 2.4) : z / 12.92;

    // Convert to XYZ using sRGB matrix
    let X = x * 0.4124564 + y * 0.3575761 + z * 0.1804375;
    let Y = x * 0.2126729 + y * 0.7151522 + z * 0.0721750;
    let Z = x * 0.0193339 + y * 0.1191920 + z * 0.9503041;

    // Normalize for D65 illuminant
    X /= 0.95047;
    Y /= 1.00000;
    Z /= 1.08883;

    // Convert to LAB
    X = X > 0.008856 ? Math.pow(X, 1/3) : (7.787 * X + 16/116);
    Y = Y > 0.008856 ? Math.pow(Y, 1/3) : (7.787 * Y + 16/116);
    Z = Z > 0.008856 ? Math.pow(Z, 1/3) : (7.787 * Z + 16/116);

    const L = 116 * Y - 16;
    const a = 500 * (X - Y);
    const b2 = 200 * (Y - Z);

    return [L, a, b2];
  }

  /**
   * Get LAB values with caching
   * @param {number} r - Red value
   * @param {number} g - Green value
   * @param {number} b - Blue value
   * @returns {number[]} Cached LAB values
   * @private
   */
  _getLab(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    let v = this._labCache.get(key);
    if (!v) {
      v = this._rgbToLab(r, g, b);
      this._labCache.set(key, v);
    }
    return v;
  }

  /**
   * Convert RGB to HSV color space
   * @param {number} r - Red value (0-255)
   * @param {number} g - Green value (0-255)
   * @param {number} b - Blue value (0-255)
   * @returns {number[]} HSV values [H (0-360), S (0-1), V (0-1)]
   * @private
   */
  _rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    const s = max === 0 ? 0 : delta / max;
    const v = max;

    if (delta !== 0) {
      if (max === r) {
        h = ((g - b) / delta) % 6;
      } else if (max === g) {
        h = (b - r) / delta + 2;
      } else {
        h = (r - g) / delta + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }

    return [h, s, v];
  }

  /**
   * Convert HSV to RGB color space
   * @param {number} h - Hue value (0-360)
   * @param {number} s - Saturation value (0-1)
   * @param {number} v - Value/Brightness (0-1)
   * @returns {number[]} RGB values [R, G, B] (0-255)
   * @private
   */
  _hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) {
      r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
      r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
      r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
      r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
      r = x; g = 0; b = c;
    } else if (h >= 300 && h < 360) {
      r = c; g = 0; b = x;
    }

    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  /**
   * Convert RGB to HSL color space
   * @param {number} r - Red value (0-255)
   * @param {number} g - Green value (0-255)
   * @param {number} b - Blue value (0-255)
   * @returns {number[]} HSL values [H (0-360), S (0-1), L (0-1)]
   * @private
   */
  _rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

      if (max === r) {
        h = ((g - b) / delta) % 6;
      } else if (max === g) {
        h = (b - r) / delta + 2;
      } else {
        h = (r - g) / delta + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }

    return [h, s, l];
  }

  /**
   * Convert HSL to RGB color space
   * @param {number} h - Hue value (0-360)
   * @param {number} s - Saturation value (0-1)
   * @param {number} l - Lightness value (0-1)
   * @returns {number[]} RGB values [R, G, B] (0-255)
   * @private
   */
  _hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) {
      r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
      r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
      r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
      r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
      r = x; g = 0; b = c;
    } else if (h >= 300 && h < 360) {
      r = c; g = 0; b = x;
    }

    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  /**
   * Convert RGB to XYZ color space
   * @param {number} r - Red value (0-255)
   * @param {number} g - Green value (0-255)
   * @param {number} b - Blue value (0-255)
   * @returns {number[]} XYZ values [X, Y, Z]
   * @private
   */
  _rgbToXyz(r, g, b) {
    // Normalize RGB values
    let x = r / 255.0;
    let y = g / 255.0;
    let z = b / 255.0;

    // Apply gamma correction
    x = x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92;
    y = y > 0.04045 ? Math.pow((y + 0.055) / 1.055, 2.4) : y / 12.92;
    z = z > 0.04045 ? Math.pow((z + 0.055) / 1.055, 2.4) : z / 12.92;

    // Convert to XYZ using sRGB matrix
    const X = x * 0.4124564 + y * 0.3575761 + z * 0.1804375;
    const Y = x * 0.2126729 + y * 0.7151522 + z * 0.0721750;
    const Z = x * 0.0193339 + y * 0.1191920 + z * 0.9503041;

    return [X, Y, Z];
  }

  /**
   * Convert XYZ to RGB color space
   * @param {number} x - X value
   * @param {number} y - Y value
   * @param {number} z - Z value
   * @returns {number[]} RGB values [R, G, B] (0-255)
   * @private
   */
  _xyzToRgb(x, y, z) {
    // Convert XYZ to linear RGB
    let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    let g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
    let b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

    // Apply gamma correction
    r = r > 0.0031308 ? 1.055 * Math.pow(r, 1.0 / 2.4) - 0.055 : 12.92 * r;
    g = g > 0.0031308 ? 1.055 * Math.pow(g, 1.0 / 2.4) - 0.055 : 12.92 * g;
    b = b > 0.0031308 ? 1.055 * Math.pow(b, 1.0 / 2.4) - 0.055 : 12.92 * b;

    // Clamp and convert to 0-255 range
    return [
      Math.round(Math.max(0, Math.min(1, r)) * 255),
      Math.round(Math.max(0, Math.min(1, g)) * 255),
      Math.round(Math.max(0, Math.min(1, b)) * 255)
    ];
  }

  /**
   * Convert RGB to LUV color space
   * @param {number} r - Red value (0-255)
   * @param {number} g - Green value (0-255)
   * @param {number} b - Blue value (0-255)
   * @returns {number[]} LUV values [L, u, v]
   * @private
   */
  _rgbToLuv(r, g, b) {
    const [X, Y, Z] = this._rgbToXyz(r, g, b);

    // Reference white D65
    const Xn = 0.95047;
    const Yn = 1.00000;
    const Zn = 1.08883;

    const yr = Y / Yn;
    const L = yr > 0.008856 ? 116 * Math.pow(yr, 1/3) - 16 : 903.3 * yr;

    const denom = X + 15 * Y + 3 * Z;
    const denomN = Xn + 15 * Yn + 3 * Zn;
    
    const up = denom === 0 ? 0 : (4 * X) / denom;
    const vp = denom === 0 ? 0 : (9 * Y) / denom;
    const upN = (4 * Xn) / denomN;
    const vpN = (9 * Yn) / denomN;

    const u = 13 * L * (up - upN);
    const v = 13 * L * (vp - vpN);

    return [L, u, v];
  }

  /**
   * Convert LUV to RGB color space
   * @param {number} l - L value
   * @param {number} u - u value
   * @param {number} v - v value
   * @returns {number[]} RGB values [R, G, B] (0-255)
   * @private
   */
  _luvToRgb(l, u, v) {
    // Reference white D65
    const Xn = 0.95047;
    const Yn = 1.00000;
    const Zn = 1.08883;

    const upN = (4 * Xn) / (Xn + 15 * Yn + 3 * Zn);
    const vpN = (9 * Yn) / (Xn + 15 * Yn + 3 * Zn);

    const Y = l > 8 ? Yn * Math.pow((l + 16) / 116, 3) : Yn * l / 903.3;

    const up = u / (13 * l) + upN;
    const vp = v / (13 * l) + vpN;

    const X = Y * 9 * up / (4 * vp);
    const Z = Y * (12 - 3 * up - 20 * vp) / (4 * vp);

    return this._xyzToRgb(X, Y, Z);
  }

  /**
   * Convert RGB to YUV color space
   * @param {number} r - Red value (0-255)
   * @param {number} g - Green value (0-255)
   * @param {number} b - Blue value (0-255)
   * @returns {number[]} YUV values [Y, U, V]
   * @private
   */
  _rgbToYuv(r, g, b) {
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const U = -0.14713 * r - 0.28886 * g + 0.436 * b;
    const V = 0.615 * r - 0.51499 * g - 0.10001 * b;

    return [Y, U, V];
  }

  /**
   * Convert YUV to RGB color space
   * @param {number} y - Y (luminance) value
   * @param {number} u - U (chrominance) value
   * @param {number} v - V (chrominance) value
   * @returns {number[]} RGB values [R, G, B] (0-255)
   * @private
   */
  _yuvToRgb(y, u, v) {
    const r = y + 1.13983 * v;
    const g = y - 0.39465 * u - 0.58060 * v;
    const b = y + 2.03211 * u;

    return [
      Math.round(Math.max(0, Math.min(255, r))),
      Math.round(Math.max(0, Math.min(255, g))),
      Math.round(Math.max(0, Math.min(255, b)))
    ];
  }

  /**
   * Convert RGB to Oklab color space (improved LAB)
   * @param {number} r - Red value (0-255)
   * @param {number} g - Green value (0-255)
   * @param {number} b - Blue value (0-255)
   * @returns {number[]} Oklab values [L, a, b]
   * @private
   */
  _rgbToOklab(r, g, b) {
    // Normalize RGB
    r /= 255;
    g /= 255;
    b /= 255;

    // Apply gamma correction
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    // Linear RGB to Oklab
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return [
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    ];
  }

  /**
   * Convert Oklab to RGB color space
   * @param {number} l - L value
   * @param {number} a - a value
   * @param {number} b - b value
   * @returns {number[]} RGB values [R, G, B] (0-255)
   * @private
   */
  _oklabToRgb(l, a, b) {
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;

    let r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    let b2 = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

    // Apply gamma correction
    r = r > 0.0031308 ? 1.055 * Math.pow(r, 1.0 / 2.4) - 0.055 : 12.92 * r;
    g = g > 0.0031308 ? 1.055 * Math.pow(g, 1.0 / 2.4) - 0.055 : 12.92 * g;
    b2 = b2 > 0.0031308 ? 1.055 * Math.pow(b2, 1.0 / 2.4) - 0.055 : 12.92 * b2;

    return [
      Math.round(Math.max(0, Math.min(1, r)) * 255),
      Math.round(Math.max(0, Math.min(1, g)) * 255),
      Math.round(Math.max(0, Math.min(1, b2)) * 255)
    ];
  }

  /**
   * Convert LAB to LCH color space (cylindrical representation)
   * @param {number} l - L value
   * @param {number} a - a value
   * @param {number} b - b value
   * @returns {number[]} LCH values [L, C, H]
   * @private
   */
  _labToLch(l, a, b) {
    const c = Math.sqrt(a * a + b * b);
    let h = Math.atan2(b, a) * 180 / Math.PI;
    if (h < 0) h += 360;

    return [l, c, h];
  }

  /**
   * Convert LCH to LAB color space
   * @param {number} l - L value
   * @param {number} c - C (chroma) value
   * @param {number} h - H (hue) value (0-360)
   * @returns {number[]} LAB values [L, a, b]
   * @private
   */
  _lchToLab(l, c, h) {
    const hRad = h * Math.PI / 180;
    const a = c * Math.cos(hRad);
    const b = c * Math.sin(hRad);

    return [l, a, b];
  }

  /**
   * Find closest color in palette using specified algorithm
   * @param {number} r - Red value
   * @param {number} g - Green value
   * @param {number} b - Blue value
   * @param {Array} palette - Array of RGB arrays [[r,g,b], ...]
   * @param {string} algorithm - 'legacy' or 'lab'
   * @param {Object} options - Additional options for color matching
   * @returns {number[]} Closest RGB color [r, g, b]
   */
  findClosestPaletteColor(r, g, b, palette, algorithm = 'lab', options = {}) {
    if (!palette || palette.length === 0) {
      return [0, 0, 0];
    }

    const { enableChromaPenalty = false, chromaPenaltyWeight = 0.15 } = options;

    if (algorithm === 'legacy') {
      let menorDist = Infinity;
      let cor = [0, 0, 0];
      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const rmean = (pr + r) / 2;
        const rdiff = pr - r;
        const gdiff = pg - g;
        const bdiff = pb - b;
        const dist = Math.sqrt(
          (((512 + rmean) * rdiff * rdiff) >> 8) +
          4 * gdiff * gdiff +
          (((767 - rmean) * bdiff * bdiff) >> 8)
        );
        if (dist < menorDist) {
          menorDist = dist;
          cor = [pr, pg, pb];
        }
      }
      return cor;
    }

    // HSV algorithm
    if (algorithm === 'hsv') {
      const [ht, st, vt] = this._rgbToHsv(r, g, b);
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const [hp, sp, vp] = this._rgbToHsv(pr, pg, pb);
        const dh = Math.min(Math.abs(ht - hp), 360 - Math.abs(ht - hp)) / 360; // Normalize hue distance
        const ds = st - sp;
        const dv = vt - vp;
        const dist = dh * dh + ds * ds + dv * dv;

        if (dist < bestDist) {
          bestDist = dist;
          best = palette[i];
          if (bestDist === 0) break;
        }
      }
      return best || [0, 0, 0];
    }

    // HSL algorithm
    if (algorithm === 'hsl') {
      const [ht, st, lt] = this._rgbToHsl(r, g, b);
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const [hp, sp, lp] = this._rgbToHsl(pr, pg, pb);
        const dh = Math.min(Math.abs(ht - hp), 360 - Math.abs(ht - hp)) / 360; // Normalize hue distance
        const ds = st - sp;
        const dl = lt - lp;
        const dist = dh * dh + ds * ds + dl * dl;

        if (dist < bestDist) {
          bestDist = dist;
          best = palette[i];
          if (bestDist === 0) break;
        }
      }
      return best || [0, 0, 0];
    }

    // XYZ algorithm
    if (algorithm === 'xyz') {
      const [xt, yt, zt] = this._rgbToXyz(r, g, b);
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const [xp, yp, zp] = this._rgbToXyz(pr, pg, pb);
        const dx = xt - xp;
        const dy = yt - yp;
        const dz = zt - zp;
        const dist = dx * dx + dy * dy + dz * dz;

        if (dist < bestDist) {
          bestDist = dist;
          best = palette[i];
          if (bestDist === 0) break;
        }
      }
      return best || [0, 0, 0];
    }

    // LUV algorithm
    if (algorithm === 'luv') {
      const [lt, ut, vt] = this._rgbToLuv(r, g, b);
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const [lp, up, vp] = this._rgbToLuv(pr, pg, pb);
        const dl = lt - lp;
        const du = ut - up;
        const dv = vt - vp;
        const dist = dl * dl + du * du + dv * dv;

        if (dist < bestDist) {
          bestDist = dist;
          best = palette[i];
          if (bestDist === 0) break;
        }
      }
      return best || [0, 0, 0];
    }

    // YUV algorithm
    if (algorithm === 'yuv') {
      const [yt, ut, vt] = this._rgbToYuv(r, g, b);
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const [yp, up, vp] = this._rgbToYuv(pr, pg, pb);
        const dy = yt - yp;
        const du = ut - up;
        const dv = vt - vp;
        const dist = dy * dy + du * du + dv * dv;

        if (dist < bestDist) {
          bestDist = dist;
          best = palette[i];
          if (bestDist === 0) break;
        }
      }
      return best || [0, 0, 0];
    }

    // Oklab algorithm
    if (algorithm === 'oklab') {
      const [lt, at, bt] = this._rgbToOklab(r, g, b);
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const [lp, ap, bp] = this._rgbToOklab(pr, pg, pb);
        const dl = lt - lp;
        const da = at - ap;
        const db = bt - bp;
        const dist = dl * dl + da * da + db * db;

        if (dist < bestDist) {
          bestDist = dist;
          best = palette[i];
          if (bestDist === 0) break;
        }
      }
      return best || [0, 0, 0];
    }

    // LCH algorithm
    if (algorithm === 'lch') {
      const [Lt, at, bt] = this._getLab(r, g, b);
      const [lt, ct, ht] = this._labToLch(Lt, at, bt);
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const [Lp, ap, bp] = this._getLab(pr, pg, pb);
        const [lp, cp, hp] = this._labToLch(Lp, ap, bp);
        const dl = lt - lp;
        const dc = ct - cp;
        const dh = Math.min(Math.abs(ht - hp), 360 - Math.abs(ht - hp)); // Circular hue distance
        const dist = dl * dl + dc * dc + (dh * dh) / 360; // Normalize hue

        if (dist < bestDist) {
          bestDist = dist;
          best = palette[i];
          if (bestDist === 0) break;
        }
      }
      return best || [0, 0, 0];
    }

    // LAB algorithm (default)
    const [Lt, at, bt] = this._getLab(r, g, b);
    const targetChroma = Math.sqrt(at * at + bt * bt);
    let best = null;
    let bestDist = Infinity;

    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i];
      const [Lp, ap, bp] = this._getLab(pr, pg, pb);
      const dL = Lt - Lp;
      const da = at - ap;
      const db = bt - bp;
      let dist = dL * dL + da * da + db * db;

      if (enableChromaPenalty && targetChroma > 20) {
        const candChroma = Math.sqrt(ap * ap + bp * bp);
        if (candChroma < targetChroma) {
          const chromaDiff = targetChroma - candChroma;
          dist += chromaDiff * chromaDiff * chromaPenaltyWeight;
        }
      }

      if (dist < bestDist) {
        bestDist = dist;
        best = palette[i];
        if (bestDist === 0) break;
      }
    }

    return best || [0, 0, 0];
  }

  /**
   * Check if a pixel is considered white based on threshold
   * @param {number} r - Red value
   * @param {number} g - Green value
   * @param {number} b - Blue value
   * @param {number} threshold - White threshold (default: 230)
   * @returns {boolean} True if pixel is white
   */
  isWhitePixel(r, g, b, threshold = this.WHITE_THRESHOLD) {
    return r >= threshold && g >= threshold && b >= threshold;
  }

  /**
   * Resolve target RGB to closest available color with caching
   * @param {number[]} targetRgb - Target RGB array [r, g, b]
   * @param {Array} availableColors - Available colors with id and rgb properties
   * @param {Object} options - Matching options
   * @returns {Object} {id: number|null, rgb: number[]}
   */
  resolveColor(targetRgb, availableColors, options = {}) {
    const {
      exactMatch = false,
      algorithm = 'lab',
      enableChromaPenalty = false,
      chromaPenaltyWeight = 0.15,
      whiteThreshold = this.WHITE_THRESHOLD
    } = options;

    if (!availableColors || availableColors.length === 0) {
      return { id: null, rgb: targetRgb };
    }

    const cacheKey = `${targetRgb[0]},${targetRgb[1]},${targetRgb[2]}|${algorithm}|${enableChromaPenalty ? 'c' : 'nc'}|${chromaPenaltyWeight}|${exactMatch ? 'exact' : 'closest'}`;

    if (this._colorCache.has(cacheKey)) {
      return this._colorCache.get(cacheKey);
    }

    // Check for exact match
    if (exactMatch) {
      const match = availableColors.find(
        (c) => c.rgb[0] === targetRgb[0] && c.rgb[1] === targetRgb[1] && c.rgb[2] === targetRgb[2]
      );
      const result = match ? { id: match.id, rgb: [...match.rgb] } : { id: null, rgb: targetRgb };
      this._colorCache.set(cacheKey, result);
      return result;
    }

    // Check for white pixel matching
    if (
      targetRgb[0] >= whiteThreshold &&
      targetRgb[1] >= whiteThreshold &&
      targetRgb[2] >= whiteThreshold
    ) {
      const whiteEntry = availableColors.find(
        (c) => c.rgb[0] >= whiteThreshold && c.rgb[1] >= whiteThreshold && c.rgb[2] >= whiteThreshold
      );
      if (whiteEntry) {
        const result = { id: whiteEntry.id, rgb: [...whiteEntry.rgb] };
        this._colorCache.set(cacheKey, result);
        return result;
      }
    }

    // Find nearest color
    let bestId = availableColors[0].id;
    let bestRgb = [...availableColors[0].rgb];
    let bestScore = Infinity;

    if (algorithm === 'legacy') {
      for (let i = 0; i < availableColors.length; i++) {
        const c = availableColors[i];
        const [r, g, b] = c.rgb;
        const rmean = (r + targetRgb[0]) / 2;
        const rdiff = r - targetRgb[0];
        const gdiff = g - targetRgb[1];
        const bdiff = b - targetRgb[2];
        const dist = Math.sqrt(
          (((512 + rmean) * rdiff * rdiff) >> 8) +
          4 * gdiff * gdiff +
          (((767 - rmean) * bdiff * bdiff) >> 8)
        );
        if (dist < bestScore) {
          bestScore = dist;
          bestId = c.id;
          bestRgb = [...c.rgb];
          if (dist === 0) break;
        }
      }
    } else {
      const [Lt, at, bt] = this._getLab(targetRgb[0], targetRgb[1], targetRgb[2]);
      const targetChroma = Math.sqrt(at * at + bt * bt);
      const penaltyWeight = enableChromaPenalty ? chromaPenaltyWeight : 0;

      for (let i = 0; i < availableColors.length; i++) {
        const c = availableColors[i];
        const [r, g, b] = c.rgb;
        const [L2, a2, b2] = this._getLab(r, g, b);
        const dL = Lt - L2;
        const da = at - a2;
        const db = bt - b2;
        let dist = dL * dL + da * da + db * db;

        if (penaltyWeight > 0 && targetChroma > 20) {
          const candChroma = Math.sqrt(a2 * a2 + b2 * b2);
          if (candChroma < targetChroma) {
            const cd = targetChroma - candChroma;
            dist += cd * cd * penaltyWeight;
          }
        }

        if (dist < bestScore) {
          bestScore = dist;
          bestId = c.id;
          bestRgb = [...c.rgb];
          if (dist === 0) break;
        }
      }
    }

    const result = { id: bestId, rgb: bestRgb };
    this._colorCache.set(cacheKey, result);

    // Limit cache size
    if (this._colorCache.size > this.COLOR_CACHE_LIMIT) {
      const firstKey = this._colorCache.keys().next().value;
      this._colorCache.delete(firstKey);
    }

    return result;
  }

  // =============================================
  // DITHERING METHODS (Floyd-Steinberg)
  // =============================================

  /**
   * Ensure dithering buffers are properly sized
   * @param {number} n - Number of pixels
   * @returns {Object} {work: Float32Array, eligible: Uint8Array}
   * @private
   */
  _ensureDitherBuffers(n) {
    if (!this._ditherWorkBuf || this._ditherWorkBuf.length !== n * 3) {
      this._ditherWorkBuf = new Float32Array(n * 3);
    }
    if (!this._ditherEligibleBuf || this._ditherEligibleBuf.length !== n) {
      this._ditherEligibleBuf = new Uint8Array(n);
    }
    return { work: this._ditherWorkBuf, eligible: this._ditherEligibleBuf };
  }

  /**
   * Apply Floyd-Steinberg dithering to image data
   * @param {Uint8ClampedArray} imageData - RGBA image data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {Array} palette - Color palette for dithering
   * @param {Object} options - Dithering options
   * @returns {Object} {data: Uint8ClampedArray, totalValidPixels: number}
   */
  applyFloydSteinbergDithering(imageData, width, height, palette, options = {}) {
    const {
      paintTransparentPixels = false,
      paintWhitePixels = true,
      transparencyThreshold = this.TRANSPARENCY_THRESHOLD,
      whiteThreshold = this.WHITE_THRESHOLD,
      algorithm = 'lab',
      enableChromaPenalty = false,
      chromaPenaltyWeight = 0.15,
      mask = null
    } = options;

    const data = new Uint8ClampedArray(imageData);
    const n = width * height;
    const { work, eligible } = this._ensureDitherBuffers(n);
    let totalValidPixels = 0;

    // Initialize working buffers
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const i4 = idx * 4;
        const r = data[i4];
        const g = data[i4 + 1];
        const b = data[i4 + 2];
        const a = data[i4 + 3];
        const masked = mask && mask[idx];

        const isEligible =
          !masked &&
          (paintTransparentPixels || a >= transparencyThreshold) &&
          (paintWhitePixels || !this.isWhitePixel(r, g, b, whiteThreshold));

        eligible[idx] = isEligible ? 1 : 0;
        work[idx * 3] = r;
        work[idx * 3 + 1] = g;
        work[idx * 3 + 2] = b;

        if (!isEligible) {
          data[i4 + 3] = 0; // Make ineligible pixels transparent
        }
      }
    }

    // Error diffusion function
    const diffuse = (nx, ny, er, eg, eb, factor) => {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
      const nidx = ny * width + nx;
      if (!eligible[nidx]) return;
      const base = nidx * 3;
      work[base] = Math.min(255, Math.max(0, work[base] + er * factor));
      work[base + 1] = Math.min(255, Math.max(0, work[base + 1] + eg * factor));
      work[base + 2] = Math.min(255, Math.max(0, work[base + 2] + eb * factor));
    };

    // Apply Floyd-Steinberg dithering
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!eligible[idx]) continue;

        const base = idx * 3;
        const r0 = work[base];
        const g0 = work[base + 1];
        const b0 = work[base + 2];

        const [nr, ng, nb] = this.findClosestPaletteColor(
          r0, g0, b0, palette, algorithm, { enableChromaPenalty, chromaPenaltyWeight }
        );

        const i4 = idx * 4;
        data[i4] = nr;
        data[i4 + 1] = ng;
        data[i4 + 2] = nb;
        data[i4 + 3] = 255;
        totalValidPixels++;

        // Calculate and diffuse error
        const er = r0 - nr;
        const eg = g0 - ng;
        const eb = b0 - nb;

        diffuse(x + 1, y, er, eg, eb, 7 / 16);
        diffuse(x - 1, y + 1, er, eg, eb, 3 / 16);
        diffuse(x, y + 1, er, eg, eb, 5 / 16);
        diffuse(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }

    return { data, totalValidPixels };
  }

  /**
   * Apply simple color quantization without dithering
   * @param {Uint8ClampedArray} imageData - RGBA image data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {Array} palette - Color palette for quantization
   * @param {Object} options - Quantization options
   * @returns {Object} {data: Uint8ClampedArray, totalValidPixels: number}
   */
  applySimpleQuantization(imageData, width, height, palette, options = {}) {
    const {
      paintTransparentPixels = false,
      paintWhitePixels = true,
      transparencyThreshold = this.TRANSPARENCY_THRESHOLD,
      whiteThreshold = this.WHITE_THRESHOLD,
      algorithm = 'lab',
      enableChromaPenalty = false,
      chromaPenaltyWeight = 0.15
    } = options;

    const data = new Uint8ClampedArray(imageData);
    let totalValidPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      const isEligible =
        (paintTransparentPixels || a >= transparencyThreshold) &&
        (paintWhitePixels || !this.isWhitePixel(r, g, b, whiteThreshold));

      if (!isEligible) {
        data[i + 3] = 0; // Make ineligible pixels transparent
        continue;
      }

      const [nr, ng, nb] = this.findClosestPaletteColor(
        r, g, b, palette, algorithm, { enableChromaPenalty, chromaPenaltyWeight }
      );

      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
      data[i + 3] = 255;
      totalValidPixels++;
    }

    return { data, totalValidPixels };
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  /**
   * Extract available colors from DOM elements
   * @returns {Array|null} Array of color objects with id and rgb properties
   */
  extractAvailableColors() {
    const colorElements = document.querySelectorAll('.color-option, [data-color-id]');
    if (colorElements.length === 0) return null;

    const colors = [];
    colorElements.forEach((element) => {
      const colorId = element.dataset.colorId || element.getAttribute('data-color-id');
      const computedStyle = window.getComputedStyle(element);
      const backgroundColor = computedStyle.backgroundColor;

      if (backgroundColor && colorId) {
        const rgbMatch = backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
          colors.push({
            id: parseInt(colorId),
            rgb: [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])]
          });
        }
      }
    });

    return colors.length > 0 ? colors : null;
  }

  /**
   * Create file uploader for images
   * @returns {Promise<string>} Promise resolving to image data URL
   */
  createImageUploader() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg';
      input.onchange = () => {
        if (input.files && input.files[0]) {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(input.files[0]);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  }

  /**
   * Extract available colors from DOM palette
   * @param {Object} colorMap - The color map object (optional, will use window.CONFIG if not provided)
   * @returns {Array|null} Array of available colors or null if none found
   */
  extractAvailableColors(colorMap = null) {
    const colorElements = document.querySelectorAll('.tooltip button[id^="color-"]');
    if (colorElements.length === 0) {
      console.log('❌ No color elements found on page');
      return null;
    }
    
    // Use provided colorMap or fallback to window.CONFIG
    const effectiveColorMap = colorMap || (window.CONFIG?.COLOR_MAP);
    
    // Separate available and unavailable colors
    const availableColors = [];
    const unavailableColors = [];

    Array.from(colorElements).forEach((el) => {
      const id = Number.parseInt(el.id.replace('color-', ''));
      if (id === 0) return; // Skip transparent color

      const rgbStr = el.style.backgroundColor.match(/\d+/g);
      if (!rgbStr || rgbStr.length < 3) {
        console.warn(`Skipping color element ${el.id} — cannot parse RGB`);
        return;
      }
      const rgb = rgbStr.map(Number);

      // Find color name from COLOR_MAP
      let name = `Unknown Color ${id}`;
      if (effectiveColorMap) {
        const colorInfo = Object.values(effectiveColorMap).find((color) => color.id === id);
        name = colorInfo ? colorInfo.name : name;
      }

      const colorData = { id, name, rgb };

      // Check if color is available (no SVG overlay means available)
      if (!el.querySelector('svg')) {
        availableColors.push(colorData);
      } else {
        unavailableColors.push(colorData);
      }
    });

    // Console log detailed color information
    console.log('=== CAPTURED COLORS STATUS ===');
    console.log(`Total available colors: ${availableColors.length}`);
    console.log(`Total unavailable colors: ${unavailableColors.length}`);
    console.log(`Total colors scanned: ${availableColors.length + unavailableColors.length}`);

    if (availableColors.length > 0) {
      console.log('\n--- AVAILABLE COLORS ---');
      availableColors.forEach((color, index) => {
        console.log(
          `${index + 1
          }. ID: ${color.id}, Name: "${color.name}", RGB: (${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`
        );
      });
    }

    if (unavailableColors.length > 0) {
      console.log('\n--- UNAVAILABLE COLORS ---');
      unavailableColors.forEach((color, index) => {
        console.log(
          `${index + 1
          }. ID: ${color.id}, Name: "${color.name}", RGB: (${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]}) [LOCKED]`
        );
      });
    }

    console.log('=== END COLOR STATUS ===');

    return availableColors;
  }

  /**
   * Clear all caches to free memory
   */
  clearCaches() {
    this._colorCache.clear();
    this._labCache.clear();
    this._hsvCache?.clear();
    this._hslCache?.clear();
    this._xyzCache?.clear();
    this._luvCache?.clear();
    this._yuvCache?.clear();
    this._oklabCache?.clear();
    this._lchCache?.clear();
    this._ditherWorkBuf = null;
    this._ditherEligibleBuf = null;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.clearCaches();
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.img = null;
    this.canvas = null;
    this.ctx = null;
  }
}

// Create global instance
window.WPlaceImageProcessor = ImageProcessor;

// Create global instance for Auto-Image.js compatibility
window.globalImageProcessor = new ImageProcessor();

// Legacy compatibility - expose key methods globally for backward compatibility
window.ImageProcessor = ImageProcessor;

console.log('✅ WPlace Image Processor loaded and ready');
