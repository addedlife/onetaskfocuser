import SwiftUI

@main
struct WebPhoneBridgeApp: App {
    @StateObject private var model = BridgeModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .onAppear {
                    model.start()
                }
        }
    }
}
