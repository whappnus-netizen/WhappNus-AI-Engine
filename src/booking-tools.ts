// booking tool module
import { createHash } from "node:crypto";
import { z } from "zod";
import { supabase } from "./db.js";

const actionSchema = z.discriminatedUnion("action", [
 z.object({action:z.literal("list_services"),arguments:z.object({}).default({})}),
 z.object({action:z.literal("check_availability"),arguments:z.object({service_id:z.string().uuid(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),staff_id:z.string().uuid().optional()})}),
 z.object({action:z.literal("create_booking"),arguments:z.object({service_id:z.string().uuid(),starts_at:z.string().datetime(),staff_id:z.string().uuid().nullable().optional(),resource_id:z.string().uuid().nullable().optional(),customer_notes:z.string().max(1000).optional()})}),
 z.object({action:z.literal("list_customer_bookings"),arguments:z.object({})}),
 z.object({action:z.literal("cancel_booking"),arguments:z.object({booking_id:z.string().uuid(),reason:z.string().max(500).optional()})}),
 z.object({action:z.literal("reschedule_booking"),arguments:z.object({booking_id:z.string().uuid(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),staff_id:z.string().uuid().nullable().optional(),resource_id:z.string().uuid().nullable().optional()})}),
]);
export type BookingAction = z.infer<typeof actionSchema>;

type ToolContext = {
 organizationId:string; contactId:string|null; conversationId:string|null; messageId:string|null;
 bookingPermissions:{enabled:boolean;canCreate:boolean;canCancel:boolean;canReschedule:boolean};
};

function localToUtc(date:string,time:string,timezone:string):Date {
 const [y,m,d]=date.split("-").map(Number); const [h,min]=time.split(":").map(Number);
 const desired=Date.UTC(y,m-1,d,h,min);
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(desired));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const represented=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));
 return new Date(desired-(represented-desired));
}
function localParts(date:Date,timezone:string) {
 const p=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date).map(x=>[x.type,x.value]));
 const weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(String(p.weekday));
 return {date:String(p.year)+"-"+String(p.month)+"-"+String(p.day),weekday,time:String(p.hour)+":"+String(p.minute)};
}
function overlaps(aStart:Date,aEnd:Date,bStart:string,bEnd:string) {
 return aStart.getTime()<new Date(bEnd).getTime() && aEnd.getTime()>new Date(bStart).getTime();
}

async function getAvailability(ctx:ToolContext,serviceId:string,date:string,requestedStaffId?:string,excludeBookingId?:string) {
 const [{data:org,error:orgError},{data:settings,error:settingsError},{data:service,error:serviceError}] = await Promise.all([
  supabase.from("organizations").select("timezone").eq("id",ctx.organizationId).single(),
  supabase.from("booking_settings").select("*").eq("organization_id",ctx.organizationId).maybeSingle(),
  supabase.from("booking_services").select("*").eq("organization_id",ctx.organizationId).eq("id",serviceId).eq("is_active",true).maybeSingle()
 ]);
 if(orgError||!org)throw new Error("ORGANIZATION_NOT_FOUND");
 if(settingsError||!settings?.enabled)throw new Error("BOOKING_FEATURE_DISABLED");
 if(serviceError||!service)throw new Error("BOOKING_SERVICE_NOT_AVAILABLE");
 const timezone=org.timezone||"Africa/Luanda";
 const localStart=localToUtc(date,"00:00",timezone);
 const localEnd=localToUtc(date,"23:59",timezone);
 if(localStart.getTime()<Date.now()+settings.min_notice_minutes*60000) {
  // Individual slots are still checked below; this only rejects dates entirely in the past.
  if(localEnd.getTime()<Date.now())return [];
 }
 const maxDate=Date.now()+settings.max_days_ahead*86400000;
 if(localStart.getTime()>maxDate)return [];
 const weekday=localParts(localStart,timezone).weekday;
 let existingBookingsQuery=supabase.from("bookings").select("id,starts_at,ends_at,staff_id,resource_id,service_id,status")
  .eq("organization_id",ctx.organizationId).lt("starts_at",new Date(localEnd.getTime()+60000).toISOString())
  .gt("ends_at",localStart.toISOString()).in("status",["pending_confirmation","confirmed","in_progress"]);
 if(excludeBookingId) existingBookingsQuery=existingBookingsQuery.neq("id",excludeBookingId);
 const [{data:orgRules,error:orgRulesError},{data:staffLinks,error:staffLinksError},{data:resourceLinks,error:resourceLinksError},{data:exceptions,error:exceptionsError},{data:existing,error:existingError}] = await Promise.all([
  supabase.from("booking_availability_rules").select("*").eq("organization_id",ctx.organizationId).eq("scope_type","organization").eq("weekday",weekday).eq("is_available",true),
  supabase.from("booking_service_staff").select("staff_id").eq("organization_id",ctx.organizationId).eq("service_id",serviceId),
  supabase.from("booking_service_resources").select("resource_id").eq("organization_id",ctx.organizationId).eq("service_id",serviceId),
  supabase.from("booking_availability_exceptions").select("*").eq("organization_id",ctx.organizationId).lt("starts_at",localEnd.toISOString()).gt("ends_at",localStart.toISOString()),
  existingBookingsQuery
 ]);
 for(const error of [orgRulesError,staffLinksError,resourceLinksError,exceptionsError,existingError])if(error)throw new Error(error.message);
 const allowedStaffIds=(staffLinks??[]).map(x=>x.staff_id);
 if(requestedStaffId && !allowedStaffIds.includes(requestedStaffId)) return [];
 const staffIds=requestedStaffId?[requestedStaffId]:allowedStaffIds;
 const resourceIds=(resourceLinks??[]).map(x=>x.resource_id);
 const [staffRows,resourceRows,staffRules,resourceRules]=await Promise.all([
  staffIds.length?supabase.from("booking_staff").select("id,display_name,is_active").eq("organization_id",ctx.organizationId).in("id",staffIds):Promise.resolve({data:[],error:null}),
  resourceIds.length?supabase.from("booking_resources").select("id,name,is_active").eq("organization_id",ctx.organizationId).in("id",resourceIds):Promise.resolve({data:[],error:null}),
  staffIds.length?supabase.from("booking_availability_rules").select("*").eq("organization_id",ctx.organizationId).eq("scope_type","staff").in("scope_id",staffIds):Promise.resolve({data:[],error:null}),
  resourceIds.length?supabase.from("booking_availability_rules").select("*").eq("organization_id",ctx.organizationId).eq("scope_type","resource").in("scope_id",resourceIds):Promise.resolve({data:[],error:null})
 ]);
 if(staffRows.error||resourceRows.error||staffRules.error||resourceRules.error)throw new Error("BOOKING_AVAILABILITY_LOOKUP_FAILED");
 const activeStaff=(staffRows.data??[]).filter(x=>x.is_active);
 const activeResources=(resourceRows.data??[]).filter(x=>x.is_active);
 const slots:Array<Record<string,unknown>>=[];
 const activeBookings=existing??[];
 for(const orgRule of orgRules??[]){
  const [startHour,startMinute]=String(orgRule.starts_at).slice(0,5).split(":").map(Number);
  const [endHour,endMinute]=String(orgRule.ends_at).slice(0,5).split(":").map(Number);
  const startTotal=startHour*60+startMinute; const endTotal=endHour*60+endMinute;
  for(let minute=startTotal;minute+service.duration_minutes<=endTotal;minute+=15){
   const hh=String(Math.floor(minute/60)).padStart(2,"0"); const mm=String(minute%60).padStart(2,"0");
   const start=localToUtc(date,hh+":"+mm,timezone);
   if(start.getTime()<Date.now()+settings.min_notice_minutes*60000||start.getTime()>maxDate)continue;
   const end=new Date(start.getTime()+service.duration_minutes*60000);
   const paddedStart=new Date(start.getTime()-service.buffer_before_minutes*60000);
   const paddedEnd=new Date(end.getTime()+service.buffer_after_minutes*60000);
   if((exceptions??[]).some(x=>x.exception_type==="unavailable"&&overlaps(start,end,x.starts_at,x.ends_at)))continue;
   if(activeBookings.filter(b=>b.service_id===serviceId&&overlaps(start,end,b.starts_at,b.ends_at)).length>=service.capacity)continue;
   const staffCandidates=allowedStaffIds.length?activeStaff:[{id:null,display_name:"Qualquer profissional",is_active:true}];
   const eligibleStaff=staffCandidates.filter(s=>{
    const own=(staffRules.data??[]).filter(r=>r.scope_id===s.id);
    const rules=own.length?own: [orgRule];
    const fits=rules.some(r=>r.is_available&&String(r.starts_at).slice(0,5)<=hh+":"+mm&&String(r.ends_at).slice(0,5)>=localParts(end,timezone).time);
    return fits&&!activeBookings.some(b=>b.staff_id===s.id&&b.status!=="cancelled"&&overlaps(paddedStart,paddedEnd,b.starts_at,b.ends_at));
   });
   const resourceCandidates=resourceIds.length?activeResources:[{id:null,name:"Sem recurso",is_active:true}];
   const eligibleResources=resourceCandidates.filter(r=>{
    const own=(resourceRules.data??[]).filter(rule=>rule.scope_id===r.id);
    const rules=own.length?own:[orgRule];
    const fits=rules.some(rule=>rule.is_available&&String(rule.starts_at).slice(0,5)<=hh+":"+mm&&String(rule.ends_at).slice(0,5)>=localParts(end,timezone).time);
    return fits&&!activeBookings.some(b=>b.resource_id===r.id&&overlaps(start,end,b.starts_at,b.ends_at));
   });
   if(eligibleStaff.length&&eligibleResources.length){
    for(const s of eligibleStaff)for(const resource of eligibleResources){
     slots.push({starts_at:start.toISOString(),ends_at:end.toISOString(),local_time:hh+":"+mm,staff_id:s.id,staff_name:s.display_name,resource_id:resource.id,resource_name:resource.name});
    }
   }
   if(slots.length>=12)break;
  }
  if(slots.length>=12)break;
 }
 return slots.slice(0,12);
}

export async function executeBookingAction(raw:unknown,ctx:ToolContext) {
 const parsed=actionSchema.safeParse(raw);
 if(!parsed.success)throw new Error("INVALID_BOOKING_ACTION");
 if(!ctx.bookingPermissions.enabled)throw new Error("BOOKING_TOOLS_NOT_AUTHORIZED");
 const {error:expiryError}=await supabase.rpc("expire_pending_bookings_v1",{p_organization_id:ctx.organizationId}); if(expiryError)throw new Error(expiryError.message);
 const action=parsed.data;
 if(action.action==="list_services"){
  const {data,error}=await supabase.from("booking_services").select("id,name,description,duration_minutes,price_amount,category").eq("organization_id",ctx.organizationId).eq("is_active",true).order("name");
  if(error)throw new Error(error.message);return {services:data??[]};
 }
 if(action.action==="check_availability"){
  const slots=await getAvailability(ctx,action.arguments.service_id,action.arguments.date,action.arguments.staff_id);
  return {date:action.arguments.date,slots};
 }
 if(action.action==="list_customer_bookings"){
  if(!ctx.contactId)throw new Error("CUSTOMER_CONTACT_REQUIRED");
  const {data,error}=await supabase.from("bookings").select("id,booking_code,service_id,starts_at,ends_at,status").eq("organization_id",ctx.organizationId).eq("contact_id",ctx.contactId).in("status",["pending_confirmation","confirmed","in_progress"]).gte("starts_at",new Date().toISOString()).order("starts_at").limit(10);
  if(error)throw new Error(error.message);
  const ids=[...new Set((data??[]).map(x=>x.service_id))];
  const services=ids.length?await supabase.from("booking_services").select("id,name").eq("organization_id",ctx.organizationId).in("id",ids):{data:[],error:null};
  if(services.error)throw new Error(services.error.message);
  const names=new Map((services.data??[]).map(x=>[x.id,x.name]));
  return {bookings:(data??[]).map(x=>({...x,service_name:names.get(x.service_id)??"Serviço"}))};
 }
 if(action.action==="create_booking"){
  if(!ctx.bookingPermissions.canCreate)throw new Error("BOOKING_CREATE_NOT_AUTHORIZED");
  if(!ctx.contactId)throw new Error("CUSTOMER_CONTACT_REQUIRED");
  const start=new Date(action.arguments.starts_at);
  if(!Number.isFinite(start.getTime()))throw new Error("BOOKING_INVALID_START_TIME");
  const {data:org,error:orgError}=await supabase.from("organizations").select("timezone").eq("id",ctx.organizationId).single();
  if(orgError||!org)throw new Error("ORGANIZATION_NOT_FOUND");
  const timezone=org.timezone||"Africa/Luanda";
  const local=localParts(start,timezone);
  const slots=await getAvailability(ctx,action.arguments.service_id,local.date,action.arguments.staff_id??undefined);
  const slot=slots.find(x=>x.starts_at===start.toISOString()&&(!action.arguments.staff_id||x.staff_id===action.arguments.staff_id)&&(!action.arguments.resource_id||x.resource_id===action.arguments.resource_id));
  if(!slot)throw new Error("BOOKING_SLOT_NO_LONGER_AVAILABLE");
  const key=createHash("sha256").update([ctx.organizationId,ctx.conversationId??"",ctx.messageId??"",action.arguments.service_id,start.toISOString()].join(":")).digest("hex");
  const {data,error}=await supabase.rpc("create_booking_v2",{
   p_organization_id:ctx.organizationId,p_contact_id:ctx.contactId,p_conversation_id:ctx.conversationId,
   p_service_id:action.arguments.service_id,p_staff_id:action.arguments.staff_id??slot.staff_id,
   p_resource_id:action.arguments.resource_id??slot.resource_id,p_starts_at:start.toISOString(),p_source:"ai",
   p_customer_notes:action.arguments.customer_notes??null,p_idempotency_key:key,p_actor_user_id:null
  });
  if(error)throw new Error(error.message);
  const createdBooking=(data as {booking?:{status?:string}}|null)?.booking;
  if(!createdBooking || !["confirmed","pending_confirmation"].includes(createdBooking.status??"")) {
   throw new Error("BOOKING_RESERVATION_NOT_ACTIVE");
  }
  return data;
 }
 if(action.action==="cancel_booking"){
  if(!ctx.bookingPermissions.canCancel)throw new Error("BOOKING_CANCEL_NOT_AUTHORIZED");
  if(!ctx.contactId)throw new Error("CUSTOMER_CONTACT_REQUIRED");
  const {data:booking,error}=await supabase.from("bookings").select("id,contact_id,status").eq("organization_id",ctx.organizationId).eq("id",action.arguments.booking_id).maybeSingle();
  if(error||!booking||booking.contact_id!==ctx.contactId)throw new Error("BOOKING_NOT_FOUND_FOR_CUSTOMER");
  const {data,error:updateError}=await supabase.rpc("update_booking_status_v1",{p_organization_id:ctx.organizationId,p_booking_id:booking.id,p_status:"cancelled",p_actor_type:"customer",p_actor_user_id:null,p_reason:action.arguments.reason??"Cancelado pelo cliente via WhatsApp"});
  if(updateError)throw new Error(updateError.message);return data;
 }
 if(action.action==="reschedule_booking"){
  if(!ctx.bookingPermissions.canReschedule)throw new Error("BOOKING_RESCHEDULE_NOT_AUTHORIZED");
  if(!ctx.contactId)throw new Error("CUSTOMER_CONTACT_REQUIRED");
  const {data:booking,error}=await supabase.from("bookings").select("id,contact_id,service_id,staff_id,resource_id,status").eq("organization_id",ctx.organizationId).eq("id",action.arguments.booking_id).maybeSingle();
  if(error||!booking||booking.contact_id!==ctx.contactId)throw new Error("BOOKING_NOT_FOUND_FOR_CUSTOMER");
  const preferredStaff=action.arguments.staff_id??booking.staff_id??undefined;
  const preferredResource=action.arguments.resource_id??booking.resource_id??undefined;
  const slots=await getAvailability(ctx,booking.service_id,action.arguments.date,preferredStaff,booking.id);
  const slot=slots.find(x=>x.local_time===action.arguments.time &&
   (!preferredStaff || x.staff_id===preferredStaff) && (!preferredResource || x.resource_id===preferredResource));
  if(!slot)throw new Error("BOOKING_SLOT_NO_LONGER_AVAILABLE");
  const {data,error:updateError}=await supabase.rpc("reschedule_booking_v1",{
   p_organization_id:ctx.organizationId,p_booking_id:booking.id,p_starts_at:slot.starts_at,
   p_staff_id:slot.staff_id,p_resource_id:slot.resource_id,p_actor_type:"customer",p_actor_user_id:null
  });
  if(updateError)throw new Error(updateError.message);return data;
 }
 throw new Error("UNSUPPORTED_BOOKING_ACTION");
}
