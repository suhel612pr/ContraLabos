/* ============================================================
   CONTRALABOS — API CLIENT (Supabase)
   ------------------------------------------------------------
   Talks to Supabase directly — no custom backend server needed.
   Auth via Supabase Auth, data via PostgREST (through supabase-js),
   files via Supabase Storage. Security is enforced by the Row
   Level Security policies in schema.sql, not by this file — this
   file just shapes requests/responses to match what the rest of
   the frontend already expects.

   Requires js/supabase-client.js (with your project URL + anon
   key filled in) loaded before this file.
   ============================================================ */

const Contralabos = (function(){

  function must(result){
    if(result.error) throw result.error;
    return result.data;
  }

  async function currentOrgId(){
    const { data: { session } } = await supabaseClient.auth.getSession();
    if(!session) return null;
    const { data } = await supabaseClient.from("profiles").select("org_id").eq("id", session.user.id).single();
    return data ? data.org_id : null;
  }

  function toPublicUser(profile, email){
    return {
      id: profile.id,
      name: profile.name,
      email: email,
      phone: profile.phone,
      role: profile.role,
      orgId: profile.org_id,
      profileComplete: profile.profile_complete,
      avatarUrl: profile.avatar_url,
      avatarInitials: profile.avatar_initials,
    };
  }

  /* ---------------- AUTH ---------------- */
  const auth = {
    async login(email, password){
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if(error) throw new Error(error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message);
      const profile = must(await supabaseClient.from("profiles").select("*").eq("id", data.user.id).single());
      return { user: toPublicUser(profile, data.user.email) };
    },

    async register(payload){
      const { name, email, password, role, orgName, inviteCode } = payload;
      // "inviteCode" here IS the organization's UUID (shown to a contractor
      // on their Profile page as "Your Organization ID — share this with
      // your team"). This is simple and functional, not a fully separate
      // expiring-token invite system — see README "Known gaps".
      const metadata = { name, role };
      if(role === "contractor") metadata.orgName = orgName;
      else metadata.orgId = inviteCode;

      const { data, error } = await supabaseClient.auth.signUp({
        email, password, options: { data: metadata }
      });
      if(error) throw new Error(error.message);
      return { user: { id: data.user.id, name, email, role }, session: data.session };
    },

    async getCurrentUser(){
      const { data: { session } } = await supabaseClient.auth.getSession();
      if(!session) return null;
      const { data: profile, error } = await supabaseClient.from("profiles").select("*").eq("id", session.user.id).single();
      if(error || !profile) return null;
      return toPublicUser(profile, session.user.email);
    },

    async logout(){
      await supabaseClient.auth.signOut();
      return { ok: true };
    },

    async completeProfile(userId, fields){
      const { phone, ...extra } = fields;
      const profile = must(await supabaseClient.from("profiles")
        .update({ phone: phone || null, extra, profile_complete: true, updated_at: new Date().toISOString() })
        .eq("id", userId).select().single());
      const { data: { session } } = await supabaseClient.auth.getSession();
      return toPublicUser(profile, session.user.email);
    },

    async forgotPassword(email){
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset-password.html",
      });
      // Always resolve the same way regardless of outcome — Supabase itself
      // doesn't reveal whether the email exists either, matching that here.
      if(error) throw new Error("Unable to send the password reset email right now.");
      return { ok: true };
    },

    async resetPassword(_token, password){
      // Supabase's recovery-link flow puts the user into an authenticated
      // "recovery" session automatically when they land on reset-password.html
      // (via detectSessionInUrl in js/supabase-client.js) — no separate token
      // parameter to pass here, unlike a custom backend's flow.
      const { error } = await supabaseClient.auth.updateUser({ password });
      if(error) throw new Error(error.message);
      return { ok: true };
    },

    async updateAvatar(userId, fileOrNull){
      if(fileOrNull === null){
        const profile = must(await supabaseClient.from("profiles")
          .update({ avatar_url: null }).eq("id", userId).select().single());
        const { data: { session } } = await supabaseClient.auth.getSession();
        return toPublicUser(profile, session.user.email);
      }
      const file = fileOrNull;
      const ext = file.name.split(".").pop();
      const path = `${userId}/avatar.${ext}`;
      const { error: upErr } = await supabaseClient.storage.from("avatars").upload(path, file, { upsert: true });
      if(upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabaseClient.storage.from("avatars").getPublicUrl(path);
      const profile = must(await supabaseClient.from("profiles")
        .update({ avatar_url: publicUrl }).eq("id", userId).select().single());
      const { data: { session } } = await supabaseClient.auth.getSession();
      return toPublicUser(profile, session.user.email);
    },

    async updateProfile(userId, fields){
      const updates = {};
      if(fields.name !== undefined) updates.name = fields.name;
      if(fields.phone !== undefined) updates.phone = fields.phone;
      updates.updated_at = new Date().toISOString();
      const profile = must(await supabaseClient.from("profiles").update(updates).eq("id", userId).select().single());
      const { data: { session } } = await supabaseClient.auth.getSession();
      return toPublicUser(profile, session.user.email);
    }
  };

  /* ---------------- PROJECTS ---------------- */
  const projects = {
    async list(filters = {}){
      let q = supabaseClient.from("project_summary").select("*").order("created_at", { ascending:false });
      if(filters.status) q = q.eq("status", filters.status);
      const rows = must(await q);
      return rows.map(toPublicProject);
    },
    async get(id){
      const { data, error } = await supabaseClient.from("project_summary").select("*").eq("id", id).single();
      if(error) return null;
      return toPublicProject(data);
    },
    async create(payload){
      const orgId = await currentOrgId();
      const row = must(await supabaseClient.from("projects").insert({
        org_id: orgId, name: payload.name, description: payload.description || null,
        supervisor_id: payload.supervisorId || null, budget: payload.budget, start_date: payload.startDate,
      }).select().single());
      return toPublicProject({ ...row, spent: 0 });
    },
    async remove(id){
      const reports = must(await supabaseClient.from("progress_reports").select("id").eq("project_id", id));
      for(const report of reports) must(await supabaseClient.from("progress_media").delete().eq("report_id", report.id));
      const requests = must(await supabaseClient.from("requests").select("id").eq("project_id", id));
      for(const request of requests) must(await supabaseClient.from("request_history").delete().eq("request_id", request.id));
      for(const table of ["progress_reports", "requests", "attendance", "payments", "material_receipts", "material_usage", "expenses", "documents", "workers"]){
        must(await supabaseClient.from(table).delete().eq("project_id", id));
      }
      must(await supabaseClient.from("projects").delete().eq("id", id));
      return { ok: true };
    }
  };
  function toPublicProject(row){
    return {
      id: row.id, name: row.name, description: row.description, supervisorId: row.supervisor_id,
      budget: Number(row.budget), spent: Number(row.spent || 0), status: row.status,
      progress: row.progress, startDate: row.start_date,
    };
  }

  /* ---------------- WORKERS ---------------- */
  const workers = {
    async list(){
      const rows = must(await supabaseClient.from("workers").select("*").order("created_at", { ascending:false }));
      return rows.map(toPublicWorker);
    },
    async get(id){
      const { data, error } = await supabaseClient.from("workers").select("*").eq("id", id).single();
      if(error) return null;
      return toPublicWorker(data);
    },
    async create(payload){
      const row = must(await supabaseClient.from("workers").insert({
        name: payload.name, project_id: payload.projectId, wage_rate: payload.wageRate, phone: payload.phone || null,
      }).select().single());
      return toPublicWorker(row);
    },
    async remove(id){
      must(await supabaseClient.from("attendance").delete().eq("worker_id", id));
      must(await supabaseClient.from("payments").delete().eq("worker_id", id));
      must(await supabaseClient.from("workers").delete().eq("id", id));
      return { ok: true };
    }
  };
  function toPublicWorker(row){
    return {
      id: row.id, name: row.name, userId: row.user_id, phone: row.phone,
      wageRate: Number(row.wage_rate), projectId: row.project_id, status: row.status,
    };
  }

  /* ---------------- ATTENDANCE ---------------- */
  const attendance = {
    async listByProject(projectId){
      const rows = must(await supabaseClient.from("attendance").select("*").eq("project_id", projectId).order("date", { ascending:false }));
      return rows.map(toPublicAttendance);
    },
    async record(entry){
      const { data: { session } } = await supabaseClient.auth.getSession();
      const { data, error } = await supabaseClient.from("attendance").insert({
        project_id: entry.projectId, worker_id: entry.workerId, date: entry.date,
        status: entry.status, recorded_by_id: session.user.id,
      }).select().single();
      if(error){
        if(error.code === "23505") throw new Error("Attendance for this worker on this date is already recorded.");
        throw new Error(error.message);
      }
      return toPublicAttendance(data);
    }
  };
  function toPublicAttendance(row){
    return { id: row.id, projectId: row.project_id, workerId: row.worker_id, date: row.date, status: row.status, recordedBy: row.recorded_by_id };
  }

  /* ---------------- REQUESTS ---------------- */
  const requests = {
    async list(filters = {}){
      let q = supabaseClient.from("requests").select("*, profiles!requests_raised_by_id_fkey(name), request_history(*)").order("created_at", { ascending:false });
      if(filters.type) q = q.eq("type", filters.type);
      if(filters.status) q = q.eq("status", filters.status);
      const rows = must(await q);
      return rows.map(toPublicRequest);
    },
    async get(displayId){
      const { data, error } = await supabaseClient.from("requests")
        .select("*, profiles!requests_raised_by_id_fkey(name), request_history(*)")
        .eq("display_id", displayId).single();
      if(error) return null;
      return toPublicRequest(data);
    },
    async create(payload){
      const { data: { session } } = await supabaseClient.auth.getSession();
      const displayId = must(await supabaseClient.rpc("next_request_display_id"));
      const row = must(await supabaseClient.from("requests").insert({
        display_id: displayId, type: payload.type, project_id: payload.projectId,
        amount: payload.amount, raised_by_id: session.user.id, note: payload.note || null,
      }).select().single());

      const { data: profile } = await supabaseClient.from("profiles").select("name").eq("id", session.user.id).single();
      await supabaseClient.from("request_history").insert({ request_id: row.id, stage: "submitted", by_name: profile.name });
      await notifications.create(`New ${payload.type} request ${displayId} submitted — awaiting review`, "request");

      return requests.get(displayId);
    },
    async advance(displayId, stage, actorName, note){
      const { data: request } = await supabaseClient.from("requests").select("id, display_id").eq("display_id", displayId).single();
      if(!request) throw new Error("Request not found.");

      const { error } = await supabaseClient.from("requests").update({ status: stage }).eq("id", request.id);
      if(error) throw new Error(error.message);

      const { data: { session } } = await supabaseClient.auth.getSession();
      const { data: profile } = await supabaseClient.from("profiles").select("name").eq("id", session.user.id).single();
      await supabaseClient.from("request_history").insert({ request_id: request.id, stage, by_name: profile.name, note: note || null });
      await notifications.create(`Request ${displayId} marked as ${stage}`, "request");

      return requests.get(displayId);
    }
  };
  function toPublicRequest(row){
    return {
      id: row.display_id, type: row.type, projectId: row.project_id, amount: Number(row.amount),
      status: row.status, raisedBy: row.profiles ? row.profiles.name : null, note: row.note,
      createdAt: row.created_at,
      history: (row.request_history || []).map(h => ({ stage: h.stage, by: h.by_name, note: h.note, at: h.at }))
        .sort((a,b) => new Date(a.at) - new Date(b.at)),
    };
  }

  /* ---------------- MATERIALS & INVENTORY ---------------- */
  const materials = {
    async catalog(){
      const rows = must(await supabaseClient.from("materials").select("*").order("name"));
      return rows.map(m => ({ id: m.id, name: m.name, unit: m.unit }));
    },
    async receipts(){
      const rows = must(await supabaseClient.from("material_receipts").select("*").order("date", { ascending:false }));
      return rows.map(r => ({ id: r.id, materialId: r.material_id, projectId: r.project_id, quantity: Number(r.quantity), cost: Number(r.cost), vendor: r.vendor, date: r.date }));
    },
    async usage(){
      const rows = must(await supabaseClient.from("material_usage").select("*").order("date", { ascending:false }));
      return rows.map(u => ({ id: u.id, materialId: u.material_id, projectId: u.project_id, quantity: Number(u.quantity), date: u.date, recordedBy: u.recorded_by_id }));
    },
    async recordReceipt(entry){
      const row = must(await supabaseClient.from("material_receipts").insert({
        material_id: entry.materialId, project_id: entry.projectId, quantity: entry.quantity,
        cost: entry.cost, vendor: entry.vendor || null, date: entry.date || new Date().toISOString().slice(0,10),
      }).select().single());
      return row;
    },
    async recordUsage(entry){
      const { data: { session } } = await supabaseClient.auth.getSession();
      const row = must(await supabaseClient.from("material_usage").insert({
        material_id: entry.materialId, project_id: entry.projectId, quantity: entry.quantity,
        recorded_by_id: session.user.id, date: entry.date || new Date().toISOString().slice(0,10),
      }).select().single());

      const isLow = must(await supabaseClient.rpc("check_low_stock", { p_project_id: entry.projectId, p_material_id: entry.materialId }));
      if(isLow){
        const { data: mat } = await supabaseClient.from("materials").select("name").eq("id", entry.materialId).single();
        await notifications.create(`Low stock: ${mat.name} running low on this project`, "stock");
      }
      return row;
    },
    async stockByProject(projectId){
      const rows = must(await supabaseClient.rpc("get_material_stock", { p_project_id: projectId }));
      return rows.map(r => ({ id: r.id, name: r.name, unit: r.unit, received: Number(r.received), used: Number(r.used), remaining: Number(r.remaining) }));
    }
  };

  /* ---------------- EXPENSES ---------------- */
  const expenses = {
    async list(filters = {}){
      let q = supabaseClient.from("expenses").select("*").order("date", { ascending:false });
      if(filters.projectId) q = q.eq("project_id", filters.projectId);
      if(filters.category) q = q.eq("category", filters.category);
      const rows = must(await q);
      return rows.map(e => ({ id: e.id, projectId: e.project_id, category: e.category, amount: Number(e.amount), vendor: e.vendor, recordedBy: e.recorded_by, date: e.date }));
    },
    async create(payload){
      const { data: { session } } = await supabaseClient.auth.getSession();
      const { data: profile } = await supabaseClient.from("profiles").select("name").eq("id", session.user.id).single();
      const row = must(await supabaseClient.from("expenses").insert({
        project_id: payload.projectId, category: payload.category, amount: payload.amount,
        vendor: payload.vendor || null, recorded_by: profile.name, date: payload.date || new Date().toISOString().slice(0,10),
      }).select().single());
      return row;
    }
  };

  /* ---------------- LABOUR PAYMENTS ---------------- */
  const payments = {
    async list(filters = {}){
      let q = supabaseClient.from("payments").select("*").order("created_at", { ascending:false });
      if(filters.workerId) q = q.eq("worker_id", filters.workerId);
      if(filters.status) q = q.eq("status", filters.status);
      const rows = must(await q);
      return rows.map(p => ({ id: p.id, workerId: p.worker_id, projectId: p.project_id, period: p.period, amount: Number(p.amount), status: p.status, paidDate: p.paid_date }));
    },
    async markPaid(id){
      const row = must(await supabaseClient.from("payments").update({ status: "paid", paid_date: new Date().toISOString().slice(0,10) }).eq("id", id).select().single());
      return row;
    },
    async generateForPeriod(period){
      const workers = must(await supabaseClient.from("workers").select("id, project_id, wage_rate"));
      const existing = must(await supabaseClient.from("payments").select("worker_id, period").eq("period", period));
      const existingKeys = new Set(existing.map(row => `${row.worker_id}:${row.period}`));
      const start = `${period}-01`;
      const end = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).toISOString().slice(0, 10);
      const attendance = must(await supabaseClient.from("attendance").select("worker_id, status, date").gte("date", start).lte("date", end));
      const rows = workers.filter(worker => !existingKeys.has(`${worker.id}:${period}`)).map(worker => {
        const days = attendance.filter(entry => entry.worker_id === worker.id).reduce((total, entry) => total + (entry.status === "present" ? 1 : entry.status === "half_day" ? 0.5 : 0), 0);
        return { worker_id: worker.id, project_id: worker.project_id, period, amount: days * Number(worker.wage_rate), status: "unpaid" };
      });
      if(!rows.length) return [];
      return must(await supabaseClient.from("payments").insert(rows).select());
    }
  };

  /* ---------------- PROGRESS REPORTS ---------------- */
  const progress = {
    async list(filters = {}){
      let q = supabaseClient.from("progress_reports").select("*, profiles!progress_reports_submitted_by_id_fkey(name)").order("date", { ascending:false });
      if(filters.projectId) q = q.eq("project_id", filters.projectId);
      const rows = must(await q);
      return rows.map(r => ({
        id: r.id, projectId: r.project_id, date: r.date, workCompleted: r.work_completed, percentage: r.percentage,
        issues: r.issues, materialNeeds: r.material_needs, nextDayPlan: r.next_day_plan,
        submittedBy: r.profiles ? r.profiles.name : null,
      }));
    },
    async submit(payload){
      const { data: { session } } = await supabaseClient.auth.getSession();
      const row = must(await supabaseClient.from("progress_reports").insert({
        project_id: payload.projectId, work_completed: payload.workCompleted, percentage: payload.percentage,
        issues: payload.issues || null, material_needs: payload.materialNeeds || null, next_day_plan: payload.nextDayPlan || null,
        submitted_by_id: session.user.id, date: new Date().toISOString().slice(0,10),
      }).select().single());

      if(payload.files && payload.files.length){
        for(const file of Array.from(payload.files)){
          const path = `${row.id}/${Date.now()}-${file.name}`;
          const { error: upErr } = await supabaseClient.storage.from("progress-media").upload(path, file);
          if(!upErr){
            const { data: { publicUrl } } = supabaseClient.storage.from("progress-media").getPublicUrl(path);
            await supabaseClient.from("progress_media").insert({ report_id: row.id, url: publicUrl, mime_type: file.type });
          }
        }
      }
      await notifications.create(`Daily progress report submitted (${payload.percentage}% complete)`, "progress");
      return row;
    }
  };

  /* ---------------- NOTIFICATIONS ---------------- */
  const notifications = {
    async list(){
      const rows = must(await supabaseClient.from("notifications").select("*").order("at", { ascending:false }).limit(100));
      return rows.map(n => ({ id: n.id, title: n.title, type: n.type, read: n.read, at: n.at }));
    },
    async markRead(id){
      await supabaseClient.from("notifications").update({ read: true }).eq("id", id);
      return true;
    },
    async create(title, type){
      const orgId = await currentOrgId();
      if(!orgId) return;
      await supabaseClient.from("notifications").insert({ org_id: orgId, title, type });
    },
    async notifyUser(userId, title, type){
      if(!userId) return;
      await supabaseClient.from("notifications").insert({ user_id: userId, title, type });
    }
  };

  /* ---------------- DOCUMENTS ---------------- */
  const documents = {
    async list(){
      const rows = must(await supabaseClient.from("documents").select("*, profiles!documents_uploaded_by_id_fkey(name)").order("date", { ascending:false }));
      return rows.map(d => ({ id: d.id, name: d.name, category: d.category, projectId: d.project_id, uploadedBy: d.profiles ? d.profiles.name : null, fileUrl: d.file_url, date: d.date }));
    },
    async upload(payload){
      const { data: { session } } = await supabaseClient.auth.getSession();
      const file = payload.file;
      const path = `${session.user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabaseClient.storage.from("documents").upload(path, file);
      if(upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabaseClient.storage.from("documents").getPublicUrl(path);

      const row = must(await supabaseClient.from("documents").insert({
        name: file.name, category: payload.category || "Other", project_id: payload.projectId || null,
        uploaded_by_id: session.user.id, file_url: publicUrl, date: new Date().toISOString().slice(0,10),
      }).select().single());
      await notifications.create(`Document uploaded: ${file.name}`, "document");
      return row;
    }
  };

  /* ---------------- MARKETPLACE ---------------- */

  function toPublicWorkerProfile(row){
    if(!row) return null;
    return {
      id: row.id,
      name: row.profiles ? row.profiles.name : row.name,
      phone: row.profiles ? row.profiles.phone : row.phone,
      avatarUrl: row.profiles ? row.profiles.avatar_url : null,
      avatarInitials: row.profiles ? row.profiles.avatar_initials : null,
      workerType: row.worker_type,
      skills: row.skills || [],
      experienceYears: Number(row.experience_years || 0),
      city: row.city, area: row.area,
      availability: row.availability,
      expectedWage: row.expected_wage !== null ? Number(row.expected_wage) : null,
      expectedWageType: row.expected_wage_type,
      bio: row.bio,
      isPublished: row.is_published,
    };
  }

  function toPublicJob(row){
    return {
      id: row.id, contractorId: row.contractor_id, orgId: row.org_id,
      contractorName: row.profiles ? row.profiles.name : null,
      orgName: row.organizations ? row.organizations.name : null,
      title: row.title, description: row.description, category: row.category,
      skillRequired: row.skill_required, workerType: row.worker_type,
      workersRequired: row.workers_required, workersHired: row.workers_hired,
      city: row.city, area: row.area, address: row.address,
      wage: row.wage !== null ? Number(row.wage) : null, wageType: row.wage_type,
      startDate: row.start_date, endDate: row.end_date, workingHours: row.working_hours,
      experienceRequired: Number(row.experience_required || 0),
      urgency: row.urgency, additionalRequirements: row.additional_requirements,
      status: row.status, projectId: row.project_id,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function toPublicApplication(row){
    return {
      id: row.id, jobId: row.job_id, workerId: row.worker_id, contractorId: row.contractor_id,
      message: row.message, status: row.status, createdAt: row.created_at,
      updatedAt: row.updated_at, reviewedAt: row.reviewed_at,
      job: row.jobs ? {
        title: row.jobs.title, wage: row.jobs.wage, wageType: row.jobs.wage_type,
        city: row.jobs.city, area: row.jobs.area, status: row.jobs.status,
        contractorName: row.jobs.profiles ? row.jobs.profiles.name : null,
      } : null,
    };
  }

  function toPublicOffer(row){
    return {
      id: row.id, jobId: row.job_id, contractorId: row.contractor_id, workerId: row.worker_id,
      message: row.message, offeredWage: row.offered_wage !== null ? Number(row.offered_wage) : null,
      status: row.status, expiresAt: row.expires_at, createdAt: row.created_at, respondedAt: row.responded_at,
      job: row.jobs ? {
        title: row.jobs.title, wage: row.jobs.wage, wageType: row.jobs.wage_type,
        city: row.jobs.city, area: row.jobs.area, startDate: row.jobs.start_date,
        contractorName: row.jobs.profiles ? row.jobs.profiles.name : null,
      } : null,
    };
  }

  function toPublicHire(row){
    return {
      id: row.id, jobId: row.job_id, contractorId: row.contractor_id, workerId: row.worker_id,
      orgId: row.org_id, agreedWage: row.agreed_wage !== null ? Number(row.agreed_wage) : null,
      status: row.status, hiredAt: row.hired_at, startDate: row.start_date, endDate: row.end_date,
      job: row.jobs ? { title: row.jobs.title, city: row.jobs.city, wageType: row.jobs.wage_type } : null,
    };
  }

  const marketplace = {

    workerProfiles: {
      async getMine(){
        const { data: { session } } = await supabaseClient.auth.getSession();
        if(!session) return null;
        const { data, error } = await supabaseClient.from("worker_profiles").select("*, profiles(name, phone, avatar_url, avatar_initials)").eq("id", session.user.id).single();
        if(error) return null;
        return toPublicWorkerProfile(data);
      },
      async get(id){
        const { data, error } = await supabaseClient.from("worker_profiles").select("*, profiles(name, phone, avatar_url, avatar_initials)").eq("id", id).single();
        if(error) return null;
        return toPublicWorkerProfile(data);
      },
      async updateMine(fields){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const updates = { updated_at: new Date().toISOString() };
        if(fields.workerType !== undefined) updates.worker_type = fields.workerType || null;
        if(fields.skills !== undefined) updates.skills = fields.skills;
        if(fields.city !== undefined) updates.city = fields.city;
        if(fields.area !== undefined) updates.area = fields.area;
        if(fields.experienceYears !== undefined) updates.experience_years = fields.experienceYears;
        if(fields.availability !== undefined) updates.availability = fields.availability;
        if(fields.expectedWage !== undefined) updates.expected_wage = fields.expectedWage || null;
        if(fields.expectedWageType !== undefined) updates.expected_wage_type = fields.expectedWageType || null;
        if(fields.bio !== undefined) updates.bio = fields.bio;
        if(fields.isPublished !== undefined) updates.is_published = fields.isPublished;
        const row = must(await supabaseClient.from("worker_profiles").upsert({ id: session.user.id, ...updates }).select().single());
        return toPublicWorkerProfile(row);
      },
      async search(filters = {}){
        let q = supabaseClient.from("worker_profiles").select("*, profiles(name, phone, avatar_url, avatar_initials)").eq("is_published", true);
        if(filters.city) q = q.ilike("city", `%${filters.city}%`);
        if(filters.skill) q = q.contains("skills", [filters.skill]);
        if(filters.workerType) q = q.eq("worker_type", filters.workerType);
        if(filters.availability) q = q.eq("availability", filters.availability);
        if(filters.minExperience) q = q.gte("experience_years", filters.minExperience);
        const rows = must(await q.order("updated_at", { ascending:false }));
        return rows.map(toPublicWorkerProfile);
      }
    },

    jobs: {
      async browsePublished(filters = {}){
        let q = supabaseClient.from("jobs")
          .select("*, profiles!jobs_contractor_id_fkey(name), organizations!jobs_org_id_fkey(name)")
          .eq("status", "published").order("created_at", { ascending:false });
        if(filters.city) q = q.ilike("city", `%${filters.city}%`);
        if(filters.skill) q = q.ilike("skill_required", `%${filters.skill}%`);
        if(filters.category) q = q.eq("category", filters.category);
        if(filters.workerType) q = q.eq("worker_type", filters.workerType);
        const rows = must(await q);
        return rows.map(toPublicJob);
      },
      async mine(){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const rows = must(await supabaseClient.from("jobs").select("*").eq("contractor_id", session.user.id).order("created_at", { ascending:false }));
        return rows.map(toPublicJob);
      },
      async get(id){
        const { data, error } = await supabaseClient.from("jobs")
          .select("*, profiles!jobs_contractor_id_fkey(name, phone), organizations!jobs_org_id_fkey(name)")
          .eq("id", id).single();
        if(error) return null;
        return toPublicJob(data);
      },
      async create(payload){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const orgId = await currentOrgId();
        if(!orgId) throw new Error("Your account isn't linked to an organization yet.");
        const row = must(await supabaseClient.from("jobs").insert({
          contractor_id: session.user.id, org_id: orgId,
          title: payload.title, description: payload.description || null, category: payload.category || null,
          skill_required: payload.skillRequired || null, worker_type: payload.workerType || null,
          workers_required: payload.workersRequired || 1,
          city: payload.city || null, area: payload.area || null, address: payload.address || null,
          wage: payload.wage || null, wage_type: payload.wageType || null,
          start_date: payload.startDate || null, end_date: payload.endDate || null,
          working_hours: payload.workingHours || null, experience_required: payload.experienceRequired || 0,
          urgency: payload.urgency || null, additional_requirements: payload.additionalRequirements || null,
          status: payload.publish ? "published" : "draft",
        }).select().single());
        return toPublicJob(row);
      },
      async update(id, payload){
        const updates = { updated_at: new Date().toISOString() };
        const map = {
          title:"title", description:"description", category:"category", skillRequired:"skill_required",
          workerType:"worker_type", workersRequired:"workers_required", city:"city", area:"area", address:"address",
          wage:"wage", wageType:"wage_type", startDate:"start_date", endDate:"end_date", workingHours:"working_hours",
          experienceRequired:"experience_required", urgency:"urgency", additionalRequirements:"additional_requirements",
        };
        Object.entries(map).forEach(([k,col]) => { if(payload[k] !== undefined) updates[col] = payload[k]; });
        const row = must(await supabaseClient.from("jobs").update(updates).eq("id", id).select().single());
        return toPublicJob(row);
      },
      async setStatus(id, status){
        const row = must(await supabaseClient.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().single());
        return toPublicJob(row);
      },
      async publish(id){ return marketplace.jobs.setStatus(id, "published"); },
      async pause(id){ return marketplace.jobs.setStatus(id, "paused"); },
      async resume(id){ return marketplace.jobs.setStatus(id, "published"); },
      async cancel(id){ return marketplace.jobs.setStatus(id, "cancelled"); },
      async remove(id){ must(await supabaseClient.from("jobs").delete().eq("id", id)); return { ok:true }; }
    },

    applications: {
      async apply(jobId, message){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const job = await marketplace.jobs.get(jobId);
        if(!job) throw new Error("This job could not be found.");
        if(job.status !== "published") throw new Error("This job is no longer accepting applications.");
        const { data, error } = await supabaseClient.from("job_applications").insert({
          job_id: jobId, worker_id: session.user.id, contractor_id: job.contractorId, message: message || null,
        }).select().single();
        if(error){
          if(error.code === "23505") throw new Error("You've already applied to this job.");
          throw new Error(error.message);
        }
        await notifications.notifyUser(job.contractorId, `New application for "${job.title}"`, "application");
        return toPublicApplication(data);
      },
      async mine(){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const rows = must(await supabaseClient.from("job_applications")
          .select("*, jobs(title, wage, wage_type, city, area, status, profiles!jobs_contractor_id_fkey(name))")
          .eq("worker_id", session.user.id).order("created_at", { ascending:false }));
        return rows.map(toPublicApplication);
      },
      async forContractor(filters = {}){
        const { data: { session } } = await supabaseClient.auth.getSession();
        let q = supabaseClient.from("job_applications")
          .select("*, jobs(title, wage, wage_type, city, area, status), profiles!job_applications_worker_id_fkey(name, phone, avatar_initials)")
          .eq("contractor_id", session.user.id).order("created_at", { ascending:false });
        if(filters.jobId) q = q.eq("job_id", filters.jobId);
        if(filters.status) q = q.eq("status", filters.status);
        const rows = must(await q);
        return rows.map(row => ({ ...toPublicApplication(row), worker: row.profiles ? { name: row.profiles.name, phone: row.profiles.phone, avatarInitials: row.profiles.avatar_initials } : null }));
      },
      async setStatus(id, status){
        const row = must(await supabaseClient.from("job_applications").update({ status }).eq("id", id).select("*, jobs(title, contractor_id)").single());
        return toPublicApplication(row);
      },
      // Hiring goes through the accept_job_application() RPC, which
      // atomically creates the hire, bumps job capacity, and bridges
      // into the `workers` table — same DB call already used before
      // this upgrade, just now terminating in 'hired' status.
      async accept(id){
        must(await supabaseClient.rpc("accept_job_application", { p_application_id: id }));
        const { data } = await supabaseClient.from("job_applications").select("*, jobs(title)").eq("id", id).single();
        if(data) await notifications.notifyUser(data.worker_id, `You're hired! Welcome aboard — "${data.jobs.title}"`, "application");
        return data ? toPublicApplication(data) : null;
      },
      async reject(id){
        const row = await marketplace.applications.setStatus(id, "rejected");
        await notifications.notifyUser(row.workerId, `Your application was declined — "${row.job ? row.job.title : ''}"`, "application");
        return row;
      },
      async shortlist(id){
        const row = await marketplace.applications.setStatus(id, "shortlisted");
        await notifications.notifyUser(row.workerId, `You've been shortlisted — "${row.job ? row.job.title : ''}"`, "application");
        return row;
      },
      async withdraw(id){ return marketplace.applications.setStatus(id, "withdrawn"); },
    },

    offers: {
      async send(payload){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const job = await marketplace.jobs.get(payload.jobId);
        if(!job) throw new Error("This job could not be found.");
        const { data, error } = await supabaseClient.from("job_offers").insert({
          job_id: payload.jobId, contractor_id: session.user.id, worker_id: payload.workerId,
          message: payload.message || null, offered_wage: payload.offeredWage || job.wage || null,
          expires_at: payload.expiresAt || null,
        }).select().single();
        if(error){
          if(error.code === "23505") throw new Error("There's already a pending offer to this worker for this job.");
          throw new Error(error.message);
        }
        await notifications.notifyUser(payload.workerId, `New job offer: "${job.title}"`, "offer");
        return toPublicOffer(data);
      },
      async sentByMe(){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const rows = must(await supabaseClient.from("job_offers")
          .select("*, jobs(title, wage, wage_type, city, area, start_date), profiles!job_offers_worker_id_fkey(name, avatar_initials)")
          .eq("contractor_id", session.user.id).order("created_at", { ascending:false }));
        return rows.map(row => ({ ...toPublicOffer(row), worker: row.profiles ? { name: row.profiles.name, avatarInitials: row.profiles.avatar_initials } : null }));
      },
      async receivedByMe(){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const rows = must(await supabaseClient.from("job_offers")
          .select("*, jobs(title, wage, wage_type, city, area, start_date, profiles!jobs_contractor_id_fkey(name))")
          .eq("worker_id", session.user.id).order("created_at", { ascending:false }));
        return rows.map(toPublicOffer);
      },
      // accept/reject go through RPCs so hiring + capacity + the
      // `workers` bridge all happen atomically server-side.
      async accept(id){
        const hire = must(await supabaseClient.rpc("accept_job_offer", { p_offer_id: id }));
        const { data } = await supabaseClient.from("job_offers").select("*, jobs(title)").eq("id", id).single();
        if(data) await notifications.notifyUser(data.contractor_id, `Worker accepted your offer for "${data.jobs.title}"`, "offer");
        return data ? toPublicOffer(data) : hire;
      },
      async reject(id){
        must(await supabaseClient.rpc("reject_job_offer", { p_offer_id: id }));
        const { data } = await supabaseClient.from("job_offers").select("*, jobs(title)").eq("id", id).single();
        if(data) await notifications.notifyUser(data.contractor_id, `Worker rejected your offer for "${data.jobs.title}"`, "offer");
        return data ? toPublicOffer(data) : null;
      },
      async withdraw(id){
        const row = must(await supabaseClient.from("job_offers").update({ status: "withdrawn" }).eq("id", id).select().single());
        return toPublicOffer(row);
      }
    },

    hires: {
      async forContractor(){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const rows = must(await supabaseClient.from("hires")
          .select("*, jobs(title, city, wage_type), profiles!hires_worker_id_fkey(name, phone, avatar_initials)")
          .eq("contractor_id", session.user.id).order("hired_at", { ascending:false }));
        return rows.map(row => ({ ...toPublicHire(row), worker: row.profiles ? { name: row.profiles.name, phone: row.profiles.phone, avatarInitials: row.profiles.avatar_initials } : null }));
      },
      async forWorker(){
        const { data: { session } } = await supabaseClient.auth.getSession();
        const rows = must(await supabaseClient.from("hires")
          .select("*, jobs(title, city, wage_type), profiles!hires_contractor_id_fkey(name, phone, avatar_initials)")
          .eq("worker_id", session.user.id).order("hired_at", { ascending:false }));
        return rows.map(row => ({ ...toPublicHire(row), contractor: row.profiles ? { name: row.profiles.name, phone: row.profiles.phone, avatarInitials: row.profiles.avatar_initials } : null }));
      },
      async cancel(id){
        const row = must(await supabaseClient.from("hires").update({ status: "cancelled" }).eq("id", id).select().single());
        return toPublicHire(row);
      },
      async complete(id){
        const row = must(await supabaseClient.from("hires").update({ status: "completed" }).eq("id", id).select().single());
        return toPublicHire(row);
      }
    },

    async matchScore(jobId, workerId){
      const { data, error } = await supabaseClient.rpc("job_match_score", { p_job_id: jobId, p_worker_id: workerId });
      if(error) return null;
      return data;
    }
  };

  /* ---------------- USERS (org directory) ---------------- */
  const users = {
    async list(){
      const rows = must(await supabaseClient.from("profiles").select("*, auth_email:id").order("created_at"));
      // profiles doesn't store email (Supabase Auth owns that) — for an org
      // directory list, showing name/role/phone is usually enough; email
      // requires an admin-only server-side call (auth.admin.listUsers)
      // which cannot run from the browser with the anon key. See README.
      return rows.map(u => ({
        id: u.id, name: u.name, email: null, phone: u.phone, role: u.role,
        orgId: u.org_id, profileComplete: u.profile_complete, avatarUrl: u.avatar_url, avatarInitials: u.avatar_initials,
      }));
    },
    async invite(){
      throw new Error(
        "Inviting users by email requires Supabase's service_role key, which " +
        "must never be used from the browser. Share your Organization ID " +
        "(see Profile page) with new team members and have them use " +
        "'Join a team' on the Register page instead."
      );
    }
  };

  /* ---------------- SUPPORT ---------------- */
  const support = {
    async listTickets(){
      const rows = must(await supabaseClient.from("support_tickets").select("*").order("created_at", { ascending:false }));
      return rows.map(t => ({ id: t.id, subject: t.subject, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at }));
    },
    async createTicket(subject){
      const { data: { session } } = await supabaseClient.auth.getSession();
      const orgId = await currentOrgId();
      const row = must(await supabaseClient.from("support_tickets").insert({ org_id: orgId, user_id: session.user.id, subject }).select().single());
      return row;
    }
  };

  /* ---------------- DASHBOARD ---------------- */
  const dashboard = {
    async contractorSummary(){
      return must(await supabaseClient.rpc("get_contractor_summary"));
    }
  };

  /* ---------------- AI ASSISTANT ---------------- */
  const assistant = {
    async sendMessage(text, lang, history = [], context = null){
      const { data, error } = await supabaseClient.functions.invoke("assistant", { body: { text, lang, history, context } });
      if(error) return { reply: null, stub: true, note: "Assistant function unavailable: " + error.message };
      return data;
    }
  };

  return {
    auth, projects, workers, attendance, requests, materials, expenses, payments,
    progress, notifications, documents, marketplace, users, support, dashboard, assistant,
  };
})();
