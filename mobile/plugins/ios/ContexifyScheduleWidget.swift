// Generated target source owned by Contexify with-assistant-alarm-widget.
import WidgetKit
import SwiftUI
import ActivityKit
import AlarmKit

@available(iOSApplicationExtension 26.0, *)
struct ContexifyScheduleActivity: Widget {
  private func interval(until end: Date) -> ClosedRange<Date> { let now = Date(); return now...max(now, end) }
  @ViewBuilder private func status(_ mode: AlarmPresentationState.Mode) -> some View {
    switch mode {
    case .countdown(let value):
      Text(timerInterval: interval(until: value.fireDate), countsDown: true).monospacedDigit().accessibilityLabel("Time remaining")
    case .paused: Text("Timer paused")
    case .alert: Text("Timer alert")
    @unknown default: Text("Check timer in Contexify")
    }
  }
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AlarmAttributes<ContexifyAlarmMetadata>.self) { context in
      VStack(alignment: .leading, spacing: 8) {
        Label("Contexify timer", systemImage: "timer")
        status(context.state.mode)
        Text("Use the system alarm controls to stop the alert, or open Contexify to cancel it.").font(.caption)
      }.padding().activityBackgroundTint(.black).activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Image(systemName: "timer").accessibilityLabel("Contexify timer") }
        DynamicIslandExpandedRegion(.trailing) { Text("Contexify") }
        DynamicIslandExpandedRegion(.bottom) { status(context.state.mode) }
      } compactLeading: { Image(systemName: "timer") }
        compactTrailing: { status(context.state.mode).frame(maxWidth: 55) }
        minimal: { Image(systemName: "timer") }
        .keylineTint(.teal)
    }
  }
}

@main
@available(iOSApplicationExtension 26.0, *)
struct ContexifyScheduleWidgetBundle: WidgetBundle {
  var body: some Widget { ContexifyScheduleActivity() }
}
