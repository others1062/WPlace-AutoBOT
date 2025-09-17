import json
import base64
from PIL import Image

def extract_image_from_data(data, output_filename):
    """Extracts the original image from the imageData."""
    image_data = data['imageData']
    width = image_data['width']
    height = image_data['height']
    pixels = image_data['pixels']

    # Create a new image with RGBA mode
    img = Image.new('RGBA', (width, height))
    # The pixel data is a flat list of R, G, B, A values
    img.putdata([tuple(pixels[i:i+4]) for i in range(0, len(pixels), 4)])
    img.save(output_filename)
    print(f"Saved original image to {output_filename}")

def extract_painted_map(data, output_filename):
    """Extracts the painted map from the paintedMapPacked."""
    painted_map = data['paintedMapPacked']
    width = painted_map['width']
    height = painted_map['height']
    encoded_data = painted_map['data']
    
    # Decode the base64 data
    decoded_data = base64.b64decode(encoded_data)
    
    # Create a color palette from the available colors
    # The 'id' from the color list is the index for the color
    color_palette = {color['id']: tuple(color['rgb']) for color in data['state']['availableColors']}
    
    # Create a new image with RGB mode
    img = Image.new('RGB', (width, height))
    pixels = []
    for byte in decoded_data:
        # Get the color from the palette using the byte as the key
        # Default to black if the color is not found
        color = color_palette.get(byte, (0, 0, 0)) 
        pixels.append(color)
        
    img.putdata(pixels)
    img.save(output_filename)
    print(f"Saved painted map to {output_filename}")


if __name__ == "__main__":
    # Load the JSON file
    with open('wplace-bot-progress-2025-09-12T19-27-37.json', 'r') as f:
        data = json.load(f)

    # Extract and save the original image
    extract_image_from_data(data, 'original_image.png')

    # Extract and save the painted map
    extract_painted_map(data, 'painted_map.png')