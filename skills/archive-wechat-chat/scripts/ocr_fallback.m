#import <CoreML/CoreML.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

static NSString *DeviceName(id<MLComputeDeviceProtocol> device) {
    NSString *className = NSStringFromClass([(NSObject *)device class]);
    if ([className containsString:@"NeuralEngine"]) return @"neuralEngine";
    if ([className containsString:@"GPU"]) return @"gpu";
    if ([className containsString:@"CPU"]) return @"cpu";
    return @"unknown";
}

static VNRecognizeTextRequest *TextRequest(void) {
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    NSUInteger latest = VNRecognizeTextRequest.supportedRevisions.lastIndex;
    if (latest != NSNotFound) request.revision = latest;
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.recognitionLanguages = @[@"zh-Hans", @"en-US"];
    request.usesLanguageCorrection = YES;
    return request;
}

static NSDictionary *ReadImage(NSString *path, NSError **error) {
    NSURL *url = [NSURL fileURLWithPath:path];
    CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
    if (!source) {
        if (error) *error = [NSError errorWithDomain:@"LocalOCR" code:1 userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Cannot decode image: %@", path]}];
        return nil;
    }
    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (!image) {
        if (error) *error = [NSError errorWithDomain:@"LocalOCR" code:1 userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Cannot decode image: %@", path]}];
        return nil;
    }

    VNRecognizeTextRequest *request = TextRequest();
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    BOOL succeeded = [handler performRequests:@[request] error:error];
    size_t width = CGImageGetWidth(image);
    size_t height = CGImageGetHeight(image);
    CGImageRelease(image);
    if (!succeeded) return nil;

    NSMutableArray *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results ?: @[]) {
        VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
        if (!candidate) continue;
        CGRect box = observation.boundingBox;
        [lines addObject:@{
            @"text": candidate.string,
            @"confidence": @(candidate.confidence),
            @"bbox": @{@"x": @(box.origin.x), @"y": @(box.origin.y), @"width": @(box.size.width), @"height": @(box.size.height)}
        }];
    }
    return @{@"path": url.path, @"width": @(width), @"height": @(height), @"lines": lines};
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fputs("Usage: ocr.sh IMAGE [IMAGE ...]\n", stderr);
            return 2;
        }

        NSMutableArray *images = [NSMutableArray array];
        for (int index = 1; index < argc; index++) {
            NSString *path = [NSString stringWithUTF8String:argv[index]];
            NSError *error = nil;
            NSDictionary *image = ReadImage(path, &error);
            if (!image) {
                fprintf(stderr, "OCR failed: %s\n", error.localizedDescription.UTF8String ?: "unknown error");
                return 1;
            }
            [images addObject:image];
        }

        NSMutableDictionary *stages = [NSMutableDictionary dictionary];
        id neuralEngineAvailable = [NSNull null];
        VNRecognizeTextRequest *probe = TextRequest();
        if (@available(macOS 14.0, *)) {
            NSError *error = nil;
            NSDictionary<NSString *, NSArray<id<MLComputeDeviceProtocol>> *> *supported = [probe supportedComputeStageDevicesAndReturnError:&error];
            if (supported) {
                BOOL hasNeuralEngine = NO;
                for (NSString *stage in supported) {
                    NSArray *devices = supported[stage];
                    NSMutableArray *names = [NSMutableArray array];
                    for (id<MLComputeDeviceProtocol> device in devices) {
                        NSString *name = DeviceName(device);
                        [names addObject:name];
                        if ([name isEqualToString:@"neuralEngine"]) hasNeuralEngine = YES;
                    }
                    stages[stage] = names;
                }
                neuralEngineAvailable = @(hasNeuralEngine);
            }
        }
        NSMutableArray *revisions = [NSMutableArray array];
        [VNRecognizeTextRequest.supportedRevisions enumerateIndexesUsingBlock:^(NSUInteger revision, BOOL *stop) {
            [revisions addObject:@(revision)];
        }];
        NSDictionary *result = @{
            @"images": images,
            @"engine": @{
                @"api": @"VNRecognizeTextRequest",
                @"implementation": @"objective-c",
                @"kind": @"text",
                @"revision": @(probe.revision),
                @"supportedRevisions": revisions,
                @"recognitionLanguages": probe.recognitionLanguages,
                @"recognitionLevel": @"accurate"
            },
            @"compute": @{
                @"selection": @"automatic",
                @"supportedDevicesByStage": stages,
                @"neuralEngineSupportedByAnyStage": neuralEngineAvailable
            }
        };
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
        if (!json) {
            fputs("OCR failed: could not encode JSON output\n", stderr);
            return 1;
        }
        fwrite(json.bytes, 1, json.length, stdout);
        fputc('\n', stdout);
        return 0;
    }
}
