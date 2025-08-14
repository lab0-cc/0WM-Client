// This module provides the HUD drawing primitives


// Draw wireless strength bars
function drawBars(ctx, y, level) {
    let i = 0;
    ctx.beginPath();
    while (i < 4) {
        ctx.rect(137 + 5 * i, 19 + 22 * y - 3 * i, 4, 6 + 3 * i);
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
        ctx.font = "19px Roboto";
    }
    ctx.fillText(ssid, 10, 25 + 22 * y, 120);

    ctx.font = "10px Roboto";
    ctx.textAlign = "center";
    ctx.fillText(`${freq}GHz`, 178, 15 + 22 * y, 40);
    ctx.fillText(`${signal}dB`, 178, 25 + 22 * y, 40);
    drawBars(ctx, y, level);
    ctx.textAlign = "start";
}


// Create a HUD canvas
export function createHUD(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    data.slice(0, 3).forEach(({ssid, signal, band}, i) => printNetwork(ctx, ssid, i, signal, band));
    return canvas
}
