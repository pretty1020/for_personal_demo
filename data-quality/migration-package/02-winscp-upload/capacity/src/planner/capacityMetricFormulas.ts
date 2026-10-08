export const PLANNED_PRODUCTION_HC_FORMULA = `Capacity start week (first week of the plan): Planned Production HC equals Actual Production HC from the saved roster count (or the prior week actual when not yet saved).

Actual weeks after the first historical week:
Prior week Actual Production HC
+ Planned graduate HC (this week)
+ Planned transfer in HC (this week)
− Planned production HC attrition
− Planned transfer out HC (this week)
− Planned off-roster / LOA HC (this week)

Future planned weeks:
Prior week Planned Production HC
+ Planned graduate HC (this week)
+ Planned transfer in HC (this week)
− Planned production HC attrition
− Planned transfer out HC (this week)
− Planned off-roster / LOA HC (this week)

Planned production HC is always calculated; stale simulation overrides are ignored.`

export const ACTUAL_PRODUCTION_HC_FORMULA = `Actual Production HC (Actual weeks):
Beginning Production HC
+ Graduate HC
+ Transfer In HC
− Attrition HC
− Transfer Out HC
− Off-roster / LOA HC

Editing Transfer In/Out (or related drivers) recalculates Production HC. A manual Production HC override is cleared when those drivers change.`
