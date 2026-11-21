'use strict';
/* QR-Code-Erzeugung ohne Fremdbibliothek (läuft auch ohne Internet).
   Byte-Modus (UTF-8), Fehlerkorrektur M (rund 15 % dürfen verdeckt oder beschädigt sein), Versionen 1 bis 10 (bis 213 Byte).
   qrMatrix(text) liefert die Modulmatrix, qrSvg(text) ein fertiges SVG. Reine Funktionen, getestet und mit einem echten
   QR-Dekoder gegengeprüft (tests_qr.py). */
// Version → [Datenwörter gesamt, Korrekturwörter je Block, Blöcke Gruppe 1, Datenwörter je Block, Blöcke Gruppe 2, Datenwörter je Block]
const qrBlocksM = { 1: [16, 10, 1, 16, 0, 0], 2: [28, 16, 1, 28, 0, 0], 3: [44, 26, 1, 44, 0, 0], 4: [64, 18, 2, 32, 0, 0], 5: [86, 24, 2, 43, 0, 0], 6: [108, 16, 4, 27, 0, 0], 7: [124, 18, 4, 31, 0, 0], 8: [154, 22, 2, 38, 2, 39], 9: [182, 22, 3, 36, 2, 37], 10: [216, 26, 4, 43, 1, 44] };
const qrAlignment = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const qrMaxBytes = 213;

// Rechnen im Galois-Körper GF(256) mit dem Polynom 0x11D
const qrExp = new Array(512), qrLog = new Array(256);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        qrExp[i] = x;
        qrLog[x] = i;
        x <<= 1;
        if (x & 256)
            x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++)
        qrExp[i] = qrExp[i - 255];
})();
const qrMul = (a, b) => a && b ? qrExp[qrLog[a] + qrLog[b]] : 0;

function qrReedSolomon(data, degree) {
    let gen = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(gen.length + 1).fill(0);
        gen.forEach((c, j) => {
            next[j] ^= c;
            next[j + 1] ^= qrMul(c, qrExp[i]);
        });
        gen = next;
    }
    const rem = new Array(degree).fill(0);
    for (const byte of data) {
        const factor = byte ^ rem.shift();
        rem.push(0);
        gen.slice(1).forEach((c, i) => rem[i] ^= qrMul(c, factor));
    }
    return rem;
}

function qrUtf8(text) {
    const bytes = [];
    for (const ch of String(text)) {
        const c = ch.codePointAt(0);
        if (c < 0x80)
            bytes.push(c);
        else if (c < 0x800)
            bytes.push(0xC0 | c >> 6, 0x80 | c & 63);
        else if (c < 0x10000)
            bytes.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
        else
            bytes.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return bytes;
}

// Datenwörter (mit Moduskennung, Länge, Endmuster und Füllbytes), dann je Block Korrekturwörter und Verschränkung
function qrCodewords(bytes, version) {
    const [dataTotal, ecPer, g1, d1, g2, d2] = qrBlocksM[version];
    const bits = [];
    const push = (value, count) => {
        for (let i = count - 1; i >= 0; i--)
            bits.push(value >>> i & 1);
    };
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, dataTotal * 8 - bits.length));
    while (bits.length % 8)
        bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8)
        data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xEC; data.length < dataTotal; pad ^= 0xEC ^ 0x11)
        data.push(pad);
    const blocks = [];
    let at = 0;
    for (let i = 0; i < g1 + g2; i++) {
        const size = i < g1 ? d1 : d2;
        const part = data.slice(at, at + size);
        at += size;
        blocks.push({ data: part, ec: qrReedSolomon(part, ecPer) });
    }
    const out = [];
    for (let i = 0; i < Math.max(d1, d2); i++)
        for (const b of blocks)
            if (i < b.data.length)
                out.push(b.data[i]);
    for (let i = 0; i < ecPer; i++)
        for (const b of blocks)
            out.push(b.ec[i]);
    return out;
}

const qrMaskTests = [(r, c) => (r + c) % 2 === 0, (r, c) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(c / 3) + Math.floor(r / 2)) % 2 === 0, (r, c) => r * c % 2 + r * c % 3 === 0, (r, c) => (r * c % 2 + r * c % 3) % 2 === 0, (r, c) => ((r + c) % 2 + r * c % 3) % 2 === 0];

function qrPenalty(m) {
    const n = m.length;
    let score = 0;
    const lines = [];
    for (let i = 0; i < n; i++) {
        lines.push(m[i].map(Number).join(''));
        lines.push(m.map(row => Number(row[i])).join(''));
    }
    for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= n; i++)
            if (i < n && line[i] === line[i - 1])
                run++;
            else {
                if (run >= 5)
                    score += 3 + run - 5;
                run = 1;
            }
        for (const pattern of ['00001011101', '10111010000'])
            for (let i = line.indexOf(pattern); i >= 0; i = line.indexOf(pattern, i + 1))
                score += 40;
    }
    for (let r = 0; r < n - 1; r++)
        for (let c = 0; c < n - 1; c++)
            if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1])
                score += 3;
    const dark = m.flat().filter(Boolean).length;
    score += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
    return score;
}

function qrBuild(version, codewords, maskNumber) {
    const size = 17 + 4 * version;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => {
        if (r >= 0 && r < size && c >= 0 && c < size) {
            modules[r][c] = dark;
            fixed[r][c] = true;
        }
    };
    const finder = (r, c) => {
        for (let dr = -4; dr <= 4; dr++)
            for (let dc = -4; dc <= 4; dc++) {
                const d = Math.max(Math.abs(dr), Math.abs(dc));
                set(r + dr, c + dc, d !== 2 && d !== 4);
            }
    };
    // Zeitmuster zuerst: Die Suchmuster überschreiben es an den Ecken
    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    finder(3, 3);
    finder(3, size - 4);
    finder(size - 4, 3);
    const pos = qrAlignment[version];
    pos.forEach((r, i) => pos.forEach((c, j) => {
        if (!(i === 0 && j === 0 || i === 0 && j === pos.length - 1 || i === pos.length - 1 && j === 0))
            for (let dr = -2; dr <= 2; dr++)
                for (let dc = -2; dc <= 2; dc++)
                    set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));
    // Formatbereiche reservieren (Inhalt folgt nach der Maske) und dunkles Modul
    const formatCells = [];
    for (let i = 0; i < 9; i++)
        formatCells.push([8, i], [i, 8]);
    for (let i = 0; i < 8; i++)
        formatCells.push([8, size - 1 - i], [size - 1 - i, 8]);
    formatCells.forEach(([r, c]) => {
        if (!fixed[r][c])
            set(r, c, false);
    });
    set(size - 8, 8, true);
    if (version >= 7) {
        let rem = version;
        for (let i = 0; i < 12; i++)
            rem = rem << 1 ^ (rem >>> 11) * 0x1F25;
        const bitsV = version << 12 | rem;
        for (let i = 0; i < 18; i++) {
            const bit = (bitsV >>> i & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3);
            set(a, b, bit);
            set(b, a, bit);
        }
    }
    // Daten im Zickzack von unten rechts
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6)
            right = 5;
        for (let vert = 0; vert < size; vert++)
            for (let j = 0; j < 2; j++) {
                const c = right - j, up = (right + 1 & 2) === 0, r = up ? size - 1 - vert : vert;
                if (!fixed[r][c] && i < codewords.length * 8) {
                    modules[r][c] = (codewords[i >>> 3] >>> 7 - (i & 7) & 1) !== 0;
                    i++;
                }
            }
    }
    for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
            if (!fixed[r][c] && qrMaskTests[maskNumber](r, c))
                modules[r][c] = !modules[r][c];
    // Formatinformation: Fehlerkorrektur M (00) und Maske
    const data = 0 << 3 | maskNumber;
    let rem = data;
    for (let k = 0; k < 10; k++)
        rem = rem << 1 ^ (rem >>> 9) * 0x537;
    const bits = (data << 10 | rem) ^ 0x5412;
    const bit = k => (bits >>> k & 1) !== 0;
    for (let k = 0; k <= 5; k++)
        modules[k][8] = bit(k);
    modules[7][8] = bit(6);
    modules[8][8] = bit(7);
    modules[8][7] = bit(8);
    for (let k = 9; k < 15; k++)
        modules[8][14 - k] = bit(k);
    for (let k = 0; k < 8; k++)
        modules[8][size - 1 - k] = bit(k);
    for (let k = 8; k < 15; k++)
        modules[size - 15 + k][8] = bit(k);
    modules[size - 8][8] = true;
    return modules;
}

// Modulmatrix (Zeilen von booleans, true = dunkel). mask: nur für Tests, sonst wird die beste Maske gewählt.
function qrMatrix(text, mask = null) {
    const bytes = qrUtf8(text);
    if (bytes.length > qrMaxBytes)
        throw Error('Der Text ist für den QR-Code zu lang (höchstens ' + qrMaxBytes + ' Byte).');
    let version = 1;
    while (4 + (version < 10 ? 8 : 16) + 8 * bytes.length > qrBlocksM[version][0] * 8)
        version++;
    const codewords = qrCodewords(bytes, version);
    if (mask !== null)
        return qrBuild(version, codewords, mask);
    let best = null, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
        const candidate = qrBuild(version, codewords, m), score = qrPenalty(candidate);
        if (score < bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}

// SVG mit weißem Rand (4 Module, wie vom Standard verlangt). Ein einziger Pfad hält die Datei klein.
function qrSvg(text, options = {}) {
    const m = qrMatrix(text), quiet = options.quiet ?? 4, n = m.length + 2 * quiet;
    let d = '';
    m.forEach((row, r) => {
        for (let c = 0; c < row.length; c++)
            if (row[c]) {
                let len = 1;
                while (c + len < row.length && row[c + len])
                    len++;
                d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h' + len + 'v1h-' + len + 'z';
                c += len - 1;
            }
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' + (options.label || 'QR-Code') + '"><rect width="' + n + '" height="' + n + '" fill="' + (options.light || '#fff') + '"/><path d="' + d + '" fill="' + (options.dark || '#000') + '"/></svg>';
}
