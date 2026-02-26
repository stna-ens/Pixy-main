
import sys
import os

# Since I don't have PIL installed in this env (based on previous error), 
# I will use a pure python logic to read the BMP (which I know works now) 
# OR I can just assume the manual BMP reader logic from before was good.
# I'll re-write the optimization script to be smarter: merging horizontal runs.

def main():
    try:
        with open('/tmp/cursor.bmp', 'rb') as f:
            data = f.read()
    except FileNotFoundError:
        import os
        # Fallback if tmp is gone
        # Try to regenerate it from the JPG if possible, but I can't without external tools easily if sips is gone?
        # Sips should be there.
        os.system("sips -s format bmp /Users/eneskis/.gemini/antigravity/brain/2d03f6af-234e-41b3-86d2-e636658cd31d/uploaded_image_1767090016963.jpg --out /tmp/cursor.bmp && sips -Z 32 /tmp/cursor.bmp")
        with open('/tmp/cursor.bmp', 'rb') as f:
            data = f.read()

    pixel_offset = int.from_bytes(data[10:14], 'little')
    width = int.from_bytes(data[18:22], 'little')
    height = int.from_bytes(data[22:26], 'little')
    bpp = int.from_bytes(data[28:30], 'little')
    
    row_size = ((width * bpp + 31) // 32) * 4
    
    grid = [[0 for _ in range(width)] for _ in range(height)]
    
    # 0 = Transparent
    # 1 = Black
    # 2 = White
    
    for y in range(height):
        y_bmp = height - 1 - y # Top-down for grid, Bottom-up for BMP
        row_start = pixel_offset + y_bmp * row_size
        
        if row_start + width * (bpp // 8) > len(data): break
        
        for x in range(width):
            if bpp == 32:
                b, g, r, a = data[row_start + x*4 : row_start + x*4 + 4]
            elif bpp == 24:
                b, g, r = data[row_start + x*3 : row_start + x*3 + 3]
            
            brightness = (r + g + b) // 3
            if brightness < 50:
                grid[y][x] = 1
            elif brightness > 230:
                grid[y][x] = 2
    
    # Generate Path with Horizonatl Merging
    def get_path(target_val):
        path = ""
        for y in range(height):
            x = 0
            while x < width:
                if grid[y][x] == target_val:
                    start_x = x
                    while x < width and grid[y][x] == target_val:
                        x += 1
                    width_run = x - start_x
                    # Append rect path: M start_x,y h width_run v 1 h -width_run z
                    path += f"M{start_x},{y}h{width_run}v1h-{width_run}z"
                else:
                    x += 1
        return path

    black_path = get_path(1)
    white_path = get_path(2)
    
    svg = f'<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">'
    svg += f'<path fill="black" d="{black_path}" />'
    svg += f'<path fill="white" d="{white_path}" />'
    svg += '</svg>'
    
    with open('/Users/eneskis/Documents/Pixy/www/assets/cursor.svg', 'w') as f:
        f.write(svg)
    print("SVG written to assets/cursor.svg", flush=True)

if __name__ == "__main__":
    main()
