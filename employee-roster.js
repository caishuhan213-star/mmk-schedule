// Price-table identities are shared by every store; profile fields stay in their
// original store records. Removing a name never deletes its profile or history.
(function (root) {
    'use strict';
    const nameOf = value => String(value ?? '').trim();
    const defaultReferrers = Object.freeze(['元元', '杨总', '加加', '点点']);

    function normalize(rows, previous = []) {
        const identities = new Map();
        previous.forEach(row => {
            if (!identities.has(nameOf(row.name))) identities.set(nameOf(row.name), row);
        });
        const result = new Map();
        const byName = new Map();
        // Referral belongs to the employee, so all grade rows carry one value.
        // Missing metadata (e.g. a price-only CSV) retains the existing referral;
        // an explicit empty value clears it across every grade.
        const referrers = new Map();
        for (const row of Array.isArray(rows) ? rows : []) {
            if (row && Object.prototype.hasOwnProperty.call(row, 'referrer')) {
                referrers.set(nameOf(row.name), nameOf(row.referrer));
            }
        }
        for (const row of Array.isArray(rows) ? rows : []) {
            if (!row) continue;
            const name = nameOf(row.name);
            const grade = nameOf(row.grade).toUpperCase();
            const price = row.price === null || nameOf(row.price) === '' ? null : Number(row.price);
            if (!name || !grade || (price !== null && (!Number.isFinite(price) || price < 0))) continue;
            const old = byName.get(name) || identities.get(name) || {};
            const employeeId = row.employeeId || old.employeeId || `price-${encodeURIComponent(name)}`;
            const aliases = [...new Set([...(old.aliases || []), ...(row.aliases || [])].map(nameOf))]
                .filter(alias => alias && alias !== name);
            const referrer = referrers.has(name) ? referrers.get(name) : nameOf(old.referrer);
            const clean = { name, grade, price, employeeId, aliases, referrer };
            byName.set(name, clean);
            result.set(JSON.stringify([name, grade]), clean);
        }
        return [...result.values()];
    }

    function roster(rows) {
        const names = new Map();
        normalize(rows).forEach(row => {
            if (!names.has(row.name)) names.set(row.name, { name: row.name, employeeId: row.employeeId, aliases: row.aliases, referrer: row.referrer });
        });
        return [...names.values()];
    }

    function reconcile(rows, profiles) {
        const people = roster(rows);
        const identities = new Set(people.map(person => person.employeeId));
        const used = new Set();
        return people.map(person => {
            const eligible = profile => {
                const legacyIdentity = `price-${encodeURIComponent(nameOf(profile.name))}`;
                const identity = profile.rosterId || (identities.has(legacyIdentity) ? legacyIdentity : null);
                return !used.has(profile) && (!identity || identity === person.employeeId);
            };
            const profile = profiles.find(p => eligible(p) && p.rosterId === person.employeeId)
                || profiles.find(p => eligible(p) && nameOf(p.name) === person.name)
                || profiles.find(p => eligible(p) && person.aliases.includes(nameOf(p.name)));
            if (profile) used.add(profile);
            return { ...(profile || {}), id: profile?.id || person.employeeId, rosterId: person.employeeId, name: person.name, referrer: person.referrer };
        });
    }

    function mergeProfiles(profiles, updated) {
        const result = new Map(profiles.map(profile => [profile.id, profile]));
        updated.forEach(profile => result.set(profile.id, { ...profile }));
        return [...result.values()];
    }

    function rename(rows, employeeId, name) {
        name = nameOf(name);
        if (!name) throw new Error('请输入员工姓名');
        if (rows.some(row => row.name === name && row.employeeId !== employeeId)) throw new Error('员工姓名已存在');
        return normalize(rows.map(row => row.employeeId === employeeId
            ? { ...row, name, aliases: [...new Set([...(row.aliases || []), row.name])].filter(alias => alias !== name) }
            : row));
    }

    function referrerOptions(rows) {
        return [...new Set([...defaultReferrers, ...roster(rows).map(person => person.referrer).filter(Boolean)])];
    }

    const api = { normalize, roster, reconcile, mergeProfiles, rename, defaultReferrers, referrerOptions };
    root.EmployeeRoster = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
