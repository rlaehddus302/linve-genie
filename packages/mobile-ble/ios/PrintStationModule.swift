import ExpoModulesCore
import UIKit

public final class PrintStationModule: Module {
  private var task = UIBackgroundTaskIdentifier.invalid

  public func definition() -> ModuleDefinition {
    Name("LiveGeniePrintStation")
    AsyncFunction("setFinishingSheet") { (working: Bool) in
      if working && self.task == .invalid {
        self.task = UIApplication.shared.beginBackgroundTask(withName: "Print label") {
          self.finish()
        }
      } else if !working {
        self.finish()
      }
    }.runOnQueue(.main)
    OnDestroy { DispatchQueue.main.async { self.finish() } }
  }

  private func finish() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }
}
