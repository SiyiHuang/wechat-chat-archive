#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:1600 pixelsHigh:1200 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
        [[NSColor whiteColor] setFill];
        NSRectFill(NSMakeRect(0, 0, 1600, 1200));
        NSDictionary *text = @{NSFontAttributeName: [NSFont systemFontOfSize:38], NSForegroundColorAttributeName: NSColor.blackColor};
        NSDictionary *heading = @{NSFontAttributeName: [NSFont boldSystemFontOfSize:56], NSForegroundColorAttributeName: NSColor.blackColor};
        [@"Workshop Participants" drawAtPoint:NSMakePoint(80, 1050) withAttributes:heading];
        [@"微信归档 文档识别测试 09:30" drawAtPoint:NSMakePoint(80, 955) withAttributes:text];
        [@"This synthetic document contains a table and a checklist." drawAtPoint:NSMakePoint(80, 875) withAttributes:text];
        NSArray *rows = @[@[@"Name", @"Role", @"Count"], @[@"Alice", @"Editor", @"42"], @[@"Bob", @"Reviewer", @"17"]];
        for (int row = 0; row <= 3; row++) {
            NSBezierPath *line = [NSBezierPath bezierPath];
            [line setLineWidth:3];
            [line moveToPoint:NSMakePoint(80, 800 - row * 125)];
            [line lineToPoint:NSMakePoint(1500, 800 - row * 125)];
            [line stroke];
        }
        const int columns[] = {80, 550, 1100, 1500};
        for (int column = 0; column < 4; column++) {
            NSBezierPath *line = [NSBezierPath bezierPath];
            [line setLineWidth:3];
            [line moveToPoint:NSMakePoint(columns[column], 425)];
            [line lineToPoint:NSMakePoint(columns[column], 800)];
            [line stroke];
        }
        for (int row = 0; row < 3; row++) for (int column = 0; column < 3; column++) {
            [rows[row][column] drawAtPoint:NSMakePoint(columns[column] + 25, 720 - row * 125) withAttributes:text];
        }
        [@"1. Capture original images" drawAtPoint:NSMakePoint(80, 300) withAttributes:text];
        [@"2. Verify the message order" drawAtPoint:NSMakePoint(80, 220) withAttributes:text];
        [NSGraphicsContext restoreGraphicsState];
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        return [png writeToFile:[NSString stringWithUTF8String:argv[1]] atomically:YES] ? 0 : 1;
    }
}
