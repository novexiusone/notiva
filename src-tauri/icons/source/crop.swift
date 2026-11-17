import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let inPath = args[1], outPath = args[2], size = Int(args[3])!
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: inPath) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let w = img.width, h = img.height
var data = [UInt8](repeating: 0, count: w*h*4)
let cs = CGColorSpaceCreateDeviceRGB()
let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w*4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
var minX = w, minY = h, maxX = 0, maxY = 0
for y in 0..<h { for x in 0..<w where data[(y*w+x)*4+3] > 8 {
  minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
print("bbox", minX, minY, maxX, maxY, "corner alpha", data[3], "center", data[((h/2)*w + w/2)*4], data[((h/2)*w + w/2)*4+1])
if size == 0 { exit(0) }
let side = max(maxX-minX+1, maxY-minY+1)
let cx = (minX+maxX+1)/2, cy = (minY+maxY+1)/2
let crop = CGRect(x: cx - side/2, y: cy - side/2, width: side, height: side)
let cropped = img.cropping(to: crop)!
let out = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
out.interpolationQuality = .high
out.draw(cropped, in: CGRect(x: 0, y: 0, width: size, height: size))
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, out.makeImage()!, nil)
CGImageDestinationFinalize(dest)
print("wrote", outPath, side)
