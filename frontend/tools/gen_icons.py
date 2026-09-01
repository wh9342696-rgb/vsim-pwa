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
    make_icon(512, os.path.join(icons_dir, 'icon-512.png'))
    make_icon(192, os.path.join(icons_dir, 'icon-192.png'))
    make_icon(180, os.path.join(icons_dir, 'apple-touch-icon.png'))
