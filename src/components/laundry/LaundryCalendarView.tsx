import {Calendar,Plus} from 'lucide-react';
import {Card,Badge,EmptyState} from '../presentationControls';
import {formatDate} from '../../lib/utils';
import type {LaundrySlot,LaundryBooking} from '../../types';
export interface LaundryCalendarSlot extends Omit<LaundrySlot,'booking'>{booking?:LaundryBooking|null;isPast?:boolean;isTaken?:boolean;}
export function LaundryCalendarView({weekDays,mobileViewDay,setMobileViewDay,getSlotsForDay,getSlotStatus,onSelect}:{weekDays:Date[];mobileViewDay:number;setMobileViewDay:(day:number)=>void;getSlotsForDay:(day:Date)=>LaundryCalendarSlot[];getSlotStatus:(slot:LaundryCalendarSlot)=>{label:string;color:string;textColor:string};onSelect:(slot:LaundryCalendarSlot,day:string)=>void}){return <>
          {/* Desktop calendar view */}
          <div className="hidden md:block overflow-x-auto">
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))' }}>
              {weekDays.map((day, dayIdx) => (
                <div key={dayIdx}>
                  <div className="text-center pb-3 border-b-2 border-slate-200">
                    <p className="text-sm font-semibold text-slate-800">
                      {day.toLocaleDateString('sv-SE', { weekday: 'short' })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {day.getDate()} {day.toLocaleDateString('sv-SE', { month: 'short' })}
                    </p>
                  </div>

                  {/* Time slots for this day */}
                  <div className="space-y-2 pt-3">
                    {getSlotsForDay(day).length === 0 && (
                      <div className="text-xs text-slate-400 text-center py-8">
                        Ingen data
                      </div>
                    )}
                    {getSlotsForDay(day).map((slot) => {
                      const status = getSlotStatus(slot);
                      const isClickable =
                        !slot.isPast &&
                        !slot.is_blocked &&
                        !slot.booking &&
                        status.label === 'Ledig';

                      return (
                        <button
                          key={slot.id}
                          onClick={() => {
                            if (isClickable) {
                              onSelect(slot,`${day.toLocaleDateString('sv-SE', { weekday: 'long' })} ${formatDate(slot.date)}`);
                            }
                          }}
                          disabled={!isClickable}
                          className={`w-full p-2 rounded-lg text-xs font-medium transition-all ${status.color} ${status.textColor} ${
                            isClickable
                              ? 'cursor-pointer hover:shadow-md active:scale-95'
                              : 'cursor-not-allowed opacity-60'
                          }`}
                        >
                          <div>{slot.start_time.slice(0,5)}</div>
                          <div className="text-xs">{status.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile calendar view (day by day) */}
          <div className="md:hidden">
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {weekDays.map((day, dayIdx) => (
                <button
                  key={dayIdx}
                  aria-pressed={mobileViewDay === dayIdx}
                  onClick={() => setMobileViewDay(dayIdx)}
                  className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-colors ${
                    mobileViewDay === dayIdx
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="text-xs">
                    {day.toLocaleDateString('sv-SE', { weekday: 'short' })}
                  </div>
                  <div className="text-sm font-bold">{day.getDate()}</div>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {getSlotsForDay(weekDays[mobileViewDay]).length === 0 ? (
                <EmptyState
                  icon={<Calendar className="w-8 h-8" />}
                  title="Inga bokningspass"
                  description="Det finns inga bokningspass registrerade för denna dag."
                />
              ) : (
                getSlotsForDay(weekDays[mobileViewDay]).map((slot) => {
                  const status = getSlotStatus(slot);
                  const isClickable =
                    !slot.isPast &&
                    !slot.is_blocked &&
                    !slot.booking &&
                    status.label === 'Ledig';

                  return (
                    <Card
                      key={slot.id}
                      onClick={() => {
                        if (isClickable) {
                          onSelect(slot,`${weekDays[mobileViewDay].toLocaleDateString('sv-SE', { weekday: 'long' })} ${formatDate(slot.date)}`);
                        }
                      }}
                      className={`p-4 transition-all ${isClickable ? 'cursor-pointer hover:shadow-md active:scale-95' : 'cursor-not-allowed opacity-60'}`}
                    >
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">
                            {slot.start_time.slice(0,5)} - {slot.end_time.slice(0,5)}
                          </p>
                          <Badge className={`${status.color} ${status.textColor} mt-1`}>
                            {status.label}
                          </Badge>
                        </div>
                        {isClickable && (
                          <Plus className="w-5 h-5 text-blue-600" />
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
</>;}
