from PIL import Image, ImageDraw
import os

icons_dir = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(icons_dir, exist_ok=True)

# Colors
bg = (91, 66, 243)  # #5B42F3
white = (255, 255, 255)

def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill)

def make_icon(size, path):
    img = Image.new('RGBA', (size, size), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    # background rounded rect
    pad = int(size * 0.03)
    rounded_rect(draw, (pad, pad, size-pad, size-pad), radius=int(size*0.15), fill=bg)
    # inner white square
    inner = int(size * 0.66)
    x = (size - inner)//2
    y = x
    draw.rounded_rectangle((x, y, x+inner, y+inner), radius=int(inner*0.08), fill=white)
    img.save(path, format='PNG', optimize=True)
    print('Wrote', path)

if __name__ == '__main__':
    # Standard app icons
    make_icon(512, os.path.join(icons_dir, 'icon-512.png'))
    make_icon(384, os.path.join(icons_dir, 'icon-384.png'))
    make_icon(256, os.path.join(icons_dir, 'icon-256.png'))
    make_icon(192, os.path.join(icons_dir, 'icon-192.png'))
    make_icon(144, os.path.join(icons_dir, 'icon-144.png'))
    make_icon(96, os.path.join(icons_dir, 'icon-96.png'))
    make_icon(48, os.path.join(icons_dir, 'icon-48.png'))
    # Apple touch icon
    make_icon(180, os.path.join(icons_dir, 'apple-touch-icon.png'))

    # Splash screens (centered logo with background)
    def make_splash(w, h, path):
        img = Image.new('RGBA', (w, h), bg + (255,))
        draw = ImageDraw.Draw(img)
        # place a centered white rounded square as logo placeholder
        logo_size = int(min(w, h) * 0.36)
        x = (w - logo_size) // 2
        y = (h - logo_size) // 2
        draw.rounded_rectangle((x, y, x+logo_size, y+logo_size), radius=int(logo_size*0.08), fill=white)
        img.save(path, format='PNG', optimize=True)
        print('Wrote', path)

    splashes = [
        (640, 1136),
        (750, 1334),
        (828, 1792),
        (1125, 2436),
        (1242, 2688),
        (1536, 2048),
        (1668, 2388),
        (2048, 2732),
        (1280, 720)
    ]
    for w, h in splashes:
        fname = f'splash-{w}x{h}.png'
        make_splash(w, h, os.path.join(icons_dir, fname))
