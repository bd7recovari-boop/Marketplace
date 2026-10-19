import { getAdminData, reinstateUser, reviewProperty, suspendUser } from './admin.js';
import { signOut } from './auth.js';
import { escapeText, formatNaira, showMessage } from './ui.js';

const message = document.querySelector('#admin-message');
const queue = document.querySelector('#review-queue');
const userRows = document.querySelector('#user-rows');
let adminData;

function stat(label, value) {
    const item = document.createElement('div');
    item.className = 'stat-item';
    const name = document.createElement('span');
    name.className = 'stat-label';
    name.textContent = label;
    const count = document.createElement('strong');
    count.className = 'stat-value';
    count.textContent = Number(value ?? 0).toLocaleString();
    item.append(name, count);
    return item;
}

function renderStats(counts) {
    const target = document.querySelector('#admin-stats');
    target.replaceChildren(
        stat('Total properties', counts.total_properties),
        stat('Pending review', counts.pending_properties),
        stat('Approved', counts.approved_properties),
        stat('Rejected', counts.rejected_properties),
        stat('Registered users', counts.total_users)
    );
    target.hidden = false;
}

function createReviewCard(property) {
    const card = document.createElement('article');
    card.className = 'review-card';
    const title = document.createElement('h3');
    title.textContent = property.title;
    const meta = document.createElement('p');
    meta.className = 'review-meta';
    meta.textContent = `${property.status} · ${property.purpose} · ${property.property_type} · ${formatNaira(property.price)} · ${property.city}, ${property.state}`;
    const area = document.createElement('p');
    area.className = 'review-meta';
    area.textContent = `Owner/agent: ${property.owner?.display_name || 'Name unavailable'} (${property.owner?.account_type || 'account type unavailable'}) · ${property.owner?.email || 'email unavailable'} · ${property.owner?.phone || 'phone unavailable'}`;
    const description = document.createElement('p');
    description.className = 'review-description';
    description.textContent = property.description;
    card.append(title, meta, area, description);

    const address = document.createElement('p');
    address.className = 'review-address';
    address.textContent = `Private address for review: ${property.address || 'Not provided'}`;
    card.append(address);

    if (property.rejection_reason) {
        const rejection = document.createElement('p');
        rejection.className = 'listing-error';
        rejection.textContent = `Previous rejection: ${property.rejection_reason}`;
        card.append(rejection);
    }

    const gallery = document.createElement('div');
    gallery.className = 'review-gallery';
    for (const image of property.images) {
        if (!image.url) continue;
        const link = document.createElement('a');
        link.href = image.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const photo = document.createElement('img');
        photo.src = image.url;
        photo.alt = image.alt_text || property.title;
        photo.loading = 'lazy';
        link.append(photo);
        gallery.append(link);
    }
    card.append(gallery);

    const evidence = document.createElement('div');
    evidence.className = 'evidence-list';
    for (const documentFile of property.documents) {
        if (!documentFile.url) continue;
        const link = document.createElement('a');
        link.href = documentFile.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `Review ${documentFile.document_type}`;
        evidence.append(link);
    }
    card.append(evidence);

    const actions = document.createElement('div');
    actions.className = 'review-actions';
    const reason = document.createElement('input');
    reason.className = 'reject-reason';
    reason.type = 'text';
    reason.required = true;
    reason.maxLength = 500;
    reason.minLength = 10;
    reason.placeholder = 'Rejection reason (required for rejection)';
    reason.setAttribute('aria-label', `Rejection reason for ${property.title}`);
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'dashboard-button';
    approve.textContent = 'Approve';
    approve.disabled = property.status === 'approved';
    approve.addEventListener('click', () => runReview(property.id, 'approved', '', approve));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'dashboard-button danger';
    reject.textContent = 'Reject';
    reject.disabled = property.status === 'rejected';
    reject.addEventListener('click', () => {
        if (!reason.reportValidity()) return;
        runReview(property.id, 'rejected', reason.value.trim(), reject);
    });
    actions.append(reason, approve, reject);
    card.append(actions);
    return card;
}

async function runReview(propertyId, decision, reason, button) {
    button.disabled = true;
    showMessage(message, `${decision === 'approved' ? 'Approving' : 'Rejecting'} listing…`);
    try {
        await reviewProperty(adminData.supabase, propertyId, decision, reason);
        showMessage(message, `Listing ${decision}.`, 'success');
        await refresh();
    } catch (error) {
        showMessage(message, error.message, 'error');
        button.disabled = false;
    }
}

function renderQueue(properties) {
    queue.replaceChildren();
    if (!properties.length) {
        const empty = document.createElement('p');
        empty.className = 'dashboard-loader';
        empty.textContent = 'No listings have been submitted yet.';
        queue.append(empty);
        return;
    }
    queue.append(...properties.map(createReviewCard));
}

function renderUsers(users) {
    userRows.replaceChildren();
    if (!users.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.className = 'empty-row';
        cell.colSpan = 6;
        cell.textContent = 'No accounts have registered yet.';
        row.append(cell);
        userRows.append(row);
        return;
    }
    for (const user of users) {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = user.display_name || 'Name not provided';
        const email = document.createElement('td');
        email.textContent = user.email;
        if (user.is_suspended) row.classList.add('user-row-suspended');
        const type = document.createElement('td');
        type.textContent = user.account_type;
        const created = document.createElement('td');
        created.textContent = new Date(user.created_at).toLocaleDateString();
        const status = document.createElement('td');
        status.textContent = user.is_suspended ? `Suspended: ${user.suspension_reason || 'No reason recorded'}` : 'Active';
        const action = document.createElement('td');
        if (user.user_id !== adminData.user.id) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = user.is_suspended ? 'inline-link' : 'inline-link user-suspend-action';
            button.textContent = user.is_suspended ? 'Reinstate' : 'Suspend';
            button.addEventListener('click', () => changeSuspension(user, button));
            action.append(button);
        } else {
            action.textContent = 'Current administrator';
        }
        row.append(name, email, type, created, status, action);
        userRows.append(row);
    }
}

async function changeSuspension(user, button) {
    if (user.is_suspended) {
        if (!window.confirm(`Reinstate ${user.email}?`)) return;
    } else {
        const reason = window.prompt(`Reason for suspending ${user.email} (10 characters minimum):`);
        if (reason === null) return;
        if (reason.trim().length < 10) {
            showMessage(message, 'Enter a suspension reason with at least 10 characters.', 'error');
            return;
        }
        button.disabled = true;
        try {
            await suspendUser(adminData.supabase, user.user_id, reason.trim());
            showMessage(message, 'Account suspended.', 'success');
            await refresh();
        } catch (error) {
            showMessage(message, error.message, 'error');
            button.disabled = false;
        }
        return;
    }
    button.disabled = true;
    try {
        await reinstateUser(adminData.supabase, user.user_id);
        showMessage(message, 'Account reinstated.', 'success');
        await refresh();
    } catch (error) {
        showMessage(message, error.message, 'error');
        button.disabled = false;
    }
}

async function refresh() {
    const fresh = await getAdminData();
    adminData = fresh;
    renderStats(fresh.counts);
    renderQueue(fresh.properties);
    renderUsers(fresh.users);
}

document.querySelector('#refresh-admin').addEventListener('click', async () => {
    try {
        showMessage(message, 'Refreshing administrator data…');
        await refresh();
        showMessage(message, 'Review data is up to date.', 'success');
    } catch (error) {
        showMessage(message, error.message, 'error');
    }
});
document.querySelector('#admin-sign-out').addEventListener('click', async () => {
    try { await signOut(); } catch (error) { showMessage(message, error.message, 'error'); return; }
    window.location.assign('account.html');
});

try {
    adminData = await getAdminData();
    renderStats(adminData.counts);
    renderQueue(adminData.properties);
    renderUsers(adminData.users);
    showMessage(message, 'Administrator access verified. Review submitted ownership evidence and location before publishing.', 'success');
} catch (error) {
    queue.replaceChildren();
    userRows.replaceChildren();
    showMessage(message, error.message, 'error');
}
