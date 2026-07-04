import SwiftUI

struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("PickForge iOS Fixture")
                .font(.title)
                .bold()

            Button("Tap me") {
                count += 1
            }
            .accessibilityIdentifier("fixture-button")

            Text("Count: \(count)")
                .accessibilityIdentifier("fixture-counter")
        }
        .padding()
    }
}
