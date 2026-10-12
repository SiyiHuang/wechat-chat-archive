#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes:NULL
            pixelsWide:1100
            pixelsHigh:320
            bitsPerSample:8
            samplesPerPixel:4
            hasAlpha:YES
            isPlanar:NO
            colorSpaceName:NSCalibratedRGBColorSpace
            bytesPerRow:0
            bitsPerPixel:0];
        NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:context];
        [[NSColor whiteColor] setFill];
        NSRectFill(NSMakeRect(0, 0, 1100, 320));
        NSDictionary *attributes = @{
            NSFontAttributeName: [NSFont systemFontOfSize:44],
            NSForegroundColorAttributeName: [NSColor blackColor]
        };
        [@"WeChat archive fixture 123" drawAtPoint:NSMakePoint(24, 205) withAttributes:attributes];
        [@"微信归档 合成测试 09:30" drawAtPoint:NSMakePoint(24, 85) withAttributes:attributes];
        [NSGraphicsContext restoreGraphicsState];
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        return [png writeToFile:[NSString stringWithUTF8String:argv[1]] atomically:YES] ? 0 : 1;
    }
}
