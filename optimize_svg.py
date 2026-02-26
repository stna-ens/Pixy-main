
import sys

def main():
    try:
        with open('/tmp/cursor.bmp', 'rb') as f:
            data = f.read()
    except:
        return

    pixel_offset = int.from_bytes(data[10:14], 'little')
    width = int.from_bytes(data[18:22], 'little')
    height = int.from_bytes(data[22:26], 'little')
    bpp = int.from_bytes(data[28:30], 'little')
    row_size = ((width * bpp + 31) // 32) * 4
    
    black_path = ""
    white_path = ""
    
    for y in range(height):
        y_flip = height - 1 - y
        row_start = pixel_offset + y * row_size
        if row_start + width * (bpp // 8) > len(data): break
        for x in range(width):
            if bpp == 32:
                b, g, r, a = data[row_start + x*4 : row_start + x*4 + 4]
            elif bpp == 24:
                b, g, r = data[row_start + x*3 : row_start + x*3 + 3]
            
            brightness = (r + g + b) // 3
            if brightness < 50:
                black_path += f"M{x},{y_flip}h1v1h-1z"
            elif brightness > 230:
                white_path += f"M{x},{y_flip}h1v1h-1z"

    svg = f'<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">'
    svg += f'<path fill="black" d="{black_path}" />'
    svg += f'<path fill="white" d="{white_path}" />'
    svg += '</svg>'
    print(svg)

if __name__ == "__main__":
    main()
