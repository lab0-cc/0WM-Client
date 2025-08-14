// This module provides the HUD drawing primitives


// Draw wireless strength bars
function drawBars(ctx, y, level) {
    let i = 0;
    ctx.beginPath();
    while (i < 4) {
        ctx.rect(274 + 10 * i, 38 + 44 * y - 6 * i, 8, 12 + 6 * i);
        if (++i === level) {
            ctx.fill()
            if (level === 4)
                return;
            ctx.fillStyle = '#fff3';
        }
    }
    ctx.fill()
    ctx.fillStyle = "#fff";
}


// Print network data
function printNetwork(ctx, ssid, y, signal, band) {
    let level;
    if (signal <= -80)
        level = 1;
    else if (signal <= -70)
        level = 2;
    else if (signal <= -60)
        level = 3;
    else {
        level = 4;
    }

    let freq;
    if (band == 2)
        freq = 2.4;
    else
        freq = band;

    if (ssid === null) {
        ctx.font = "italic 19px Roboto";
        ssid = "<no name>";
    }
    else {
        ctx.font = "38px Roboto";
    }
    ctx.fillText(ssid, 20, 50 + 44 * y, 240);

    ctx.font = "20px Roboto";
    ctx.textAlign = "center";
    ctx.fillText(`${freq}GHz`, 356, 30 + 44 * y, 80);
    ctx.fillText(`${signal}dB`, 356, 50 + 44 * y, 80);
    drawBars(ctx, y, level);
    ctx.textAlign = "start";
}


// Create a HUD canvas
export function createHUD(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.roundRect(0, 0, canvas.width, canvas.height, 20);
    ctx.fill();
    ctx.fillStyle = "#fff";
    data.slice(0, 3).forEach(({ssid, signal, band}, i) => printNetwork(ctx, ssid, i, signal, band));
    return canvas
}
