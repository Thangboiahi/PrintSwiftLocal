'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  EyeOff,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Rocket,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import {
  normalizeOperationsConfig,
  type HelpbotFaqRecord,
  type OperationsConfig,
} from '@/lib/config/types';
import { useAuth } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';
import { updateHideSampleDataFlag } from '@/lib/supabase/platform-settings';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';

/* -------------------------------------------------------------------------- */
/* TAB 5: HELPBOT Q&A CMS                                                     */
/* -------------------------------------------------------------------------- */

export function HelpbotFaqTab({
  onNotify,
  refreshGlobalConfig,
}: MasterControlTabSharedProps) {
  const [faqs, setFaqs] = useState<HelpbotFaqRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Add new FAQ form
  const [newCategory, setNewCategory] = useState('general');
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newDeepLink, setNewDeepLink] = useState('');
  const [newSortOrder, setNewSortOrder] = useState('50');

  const loadFaqs = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('helpbot_faqs')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('updated_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        setFaqs(
          data.map((row) => ({
            id: String(row.id),
            category: String(row.category ?? 'general'),
            question: String(row.question ?? ''),
            answer: String(row.answer ?? ''),
            keywords: Array.isArray(row.keywords)
              ? row.keywords.map((k: unknown) => String(k))
              : [],
            deep_link_url:
              typeof row.deep_link_url === 'string' && row.deep_link_url.trim()
                ? row.deep_link_url
                : null,
            sort_order: Number(row.sort_order ?? 100),
            is_active: Boolean(row.is_active),
            updated_at:
              typeof row.updated_at === 'string' ? row.updated_at : undefined,
          }))
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadFaqs();
    });
  }, [loadFaqs]);

  const parseKeywords = (raw: string): string[] =>
    raw
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

  const handleCreateFaq = async () => {
    if (!newQuestion.trim() || !newAnswer.trim()) {
      onNotify?.({
        type: 'error',
        text: 'Question and answer are both required.',
      });
      return;
    }

    setCreating(true);
    setAppStatus('saving', 'Adding Helpbot Q&A...');
    try {
      const { error } = await supabase.from('helpbot_faqs').insert({
        category: newCategory.trim() || 'general',
        question: newQuestion.trim(),
        answer: newAnswer.trim(),
        keywords: parseKeywords(newKeywords),
        deep_link_url: newDeepLink.trim() || null,
        sort_order: Number(newSortOrder) || 50,
        is_active: true,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setNewQuestion('');
      setNewAnswer('');
      setNewKeywords('');
      setNewDeepLink('');
      setAppStatus('success', 'Helpbot Q&A added.');
      onNotify?.({ type: 'success', text: 'Helpbot Q&A added and published.' });
      await loadFaqs();
      await refreshGlobalConfig();
    } finally {
      setCreating(false);
    }
  };

  const handleSaveFaq = async (faq: HelpbotFaqRecord) => {
    setSavingId(faq.id);
    setAppStatus('saving', 'Saving Helpbot Q&A...');
    try {
      const { error } = await supabase
        .from('helpbot_faqs')
        .update({
          category: faq.category.trim() || 'general',
          question: faq.question.trim(),
          answer: faq.answer.trim(),
          keywords: faq.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean),
          deep_link_url: faq.deep_link_url?.trim() || null,
          sort_order: Number(faq.sort_order) || 100,
          is_active: faq.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', faq.id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setAppStatus('success', 'Helpbot Q&A saved.');
      onNotify?.({ type: 'success', text: 'Helpbot Q&A updated.' });
      await refreshGlobalConfig();
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteFaq = async (id: string) => {
    setSavingId(`del:${id}`);
    setAppStatus('saving', 'Removing Q&A...');
    try {
      const { error } = await supabase
        .from('helpbot_faqs')
        .delete()
        .eq('id', id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setFaqs((prev) => prev.filter((item) => item.id !== id));
      setAppStatus('success', 'Helpbot Q&A deleted.');
      onNotify?.({ type: 'info', text: 'Helpbot Q&A removed.' });
      await refreshGlobalConfig();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add New FAQ */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <Bot className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              Add Helpbot Q&A Knowledge Entry
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Updates the live in-app AssistantWidget immediately without
              redeployment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadFaqs()}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Reload
          </button>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase">
              Category
            </span>
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. payments, pick_n_drop, vehicles"
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase">
              Deep Link URL (Optional)
            </span>
            <input
              type="text"
              value={newDeepLink}
              onChange={(e) => setNewDeepLink(e.target.value)}
              placeholder="/pick-n-drop or /explore"
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase">
              Sort Order
            </span>
            <input
              type="number"
              value={newSortOrder}
              onChange={(e) => setNewSortOrder(e.target.value)}
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
        </div>

        <div className="mt-2.5 space-y-2">
          <input
            type="text"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Question (e.g. How do I pay for a vehicle booking?)"
            className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <textarea
            rows={2}
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            placeholder="Concise, helpful answer shown by the Helpbot..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newKeywords}
              onChange={(e) => setNewKeywords(e.target.value)}
              placeholder="Keywords (comma-separated: upi, razorpay, refund, booking)"
              className="h-8 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreateFaq()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add Q&A
            </button>
          </div>
        </div>
      </div>

      {/* Existing FAQs */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
          Configured Helpbot Q&As ({faqs.length})
        </h3>
        {isLoading && faqs.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading Helpbot Q&As...
          </div>
        ) : faqs.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">
            No Helpbot Q&A entries yet.
          </p>
        ) : (
          <div className="space-y-3">
            {faqs.map((faq) => {
              const isSaving = savingId === faq.id;
              const isDeleting = savingId === `del:${faq.id}`;
              return (
                <div
                  key={faq.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={faq.category}
                        onChange={(e) =>
                          setFaqs((prev) =>
                            prev.map((item) =>
                              item.id === faq.id
                                ? { ...item, category: e.target.value }
                                : item
                            )
                          )
                        }
                        className="h-7 w-28 rounded border border-slate-200 bg-white px-2 text-[11px] font-semibold uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <input
                        type="number"
                        value={faq.sort_order}
                        onChange={(e) =>
                          setFaqs((prev) =>
                            prev.map((item) =>
                              item.id === faq.id
                                ? {
                                    ...item,
                                    sort_order: Number(e.target.value) || 0,
                                  }
                                : item
                            )
                          )
                        }
                        title="Sort order"
                        className="h-7 w-16 rounded border border-slate-200 bg-white px-2 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={faq.deep_link_url ?? ''}
                        onChange={(e) =>
                          setFaqs((prev) =>
                            prev.map((item) =>
                              item.id === faq.id
                                ? { ...item, deep_link_url: e.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Deep link (/route)"
                        className="h-7 w-36 rounded border border-slate-200 bg-white px-2 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setFaqs((prev) =>
                            prev.map((item) =>
                              item.id === faq.id
                                ? { ...item, is_active: !item.is_active }
                                : item
                            )
                          )
                        }
                        className={`h-7 rounded-md px-2 text-[10px] font-semibold ${
                          faq.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {faq.is_active ? 'Active' : 'Hidden'}
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleSaveFaq(faq)}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-600"
                      >
                        {isSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void handleDeleteFaq(faq.id)}
                        title="Delete FAQ"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:bg-slate-900 dark:text-rose-400"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={faq.question}
                      onChange={(e) =>
                        setFaqs((prev) =>
                          prev.map((item) =>
                            item.id === faq.id
                              ? { ...item, question: e.target.value }
                              : item
                          )
                        )
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <textarea
                      rows={2}
                      value={faq.answer}
                      onChange={(e) =>
                        setFaqs((prev) =>
                          prev.map((item) =>
                            item.id === faq.id
                              ? { ...item, answer: e.target.value }
                              : item
                          )
                        )
                      }
                      className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                    <input
                      type="text"
                      value={faq.keywords.join(', ')}
                      onChange={(e) =>
                        setFaqs((prev) =>
                          prev.map((item) =>
                            item.id === faq.id
                              ? {
                                  ...item,
                                  keywords: e.target.value
                                    .split(',')
                                    .map((k) => k.trim()),
                                }
                              : item
                          )
                        )
                      }
                      placeholder="Keywords (comma separated)"
                      className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TAB 6: OPERATIONS & MODULE KILL SWITCHES                                   */
/* -------------------------------------------------------------------------- */

interface OperationsSwitchesTabProps extends MasterControlTabSharedProps {
  initialOperations: OperationsConfig;
}

type ModuleSwitchKey = keyof OperationsConfig['module_switches'];

const MODULE_META: Array<{
  key: ModuleSwitchKey;
  title: string;
  desc: string;
}> = [
  {
    key: 'explore',
    title: 'Explore Directory & Map',
    desc: 'District places, businesses, schools, churches & interactive map.',
  },
  {
    key: 'marketplace',
    title: 'Local Marketplace',
    desc: 'Peer-to-peer listings, shop storefronts, and local classifieds.',
  },
  {
    key: 'bulletin',
    title: 'Community Bulletin',
    desc: 'District announcements, events, job postings, and paid promos.',
  },
  {
    key: 'pick_n_drop',
    title: 'Pick N Drop Courier',
    desc: 'On-demand parcel, passenger rides, and LPG cylinder dispatch.',
  },
  {
    key: 'vehicle_bookings',
    title: 'Vehicle Rentals & Bookings',
    desc: 'Bolero, taxi, inter-city seat & full-vehicle scheduling.',
  },
  {
    key: 'print_orders',
    title: 'Print & Digital Ordering',
    desc: 'Online PDF/photo printing, custom digital quotes, and Official PrintSwift.',
  },
  {
    key: 'booking_venues',
    title: 'Venue & Turf Bookings',
    desc: 'Instant turf slot booking, event hall reservations, and hourly/daily rentals.',
  },
  {
    key: 'hotel_stays',
    title: 'Hotels & Homestays',
    desc: 'Multi-unit nightly room inventory, check-in OTPs, and hospitality bookings.',
  },
  {
    key: 'shop_orders',
    title: 'Shop Catalogue Orders',
    desc: 'Local storefront ordering, counter pickup, and Pick N Drop shop delivery.',
  },
  {
    key: 'food_orders',
    title: 'Restaurants & Food Orders',
    desc: 'Digital menus, takeaway, hot-food Pick N Drop delivery, and table reservations.',
  },
  {
    key: 'real_estate',
    title: 'Real Estate & Properties',
    desc: 'Lightweight property listings, Patta/Site verification, 30-day freshness, and site visits.',
  },
];

export function OperationsSwitchesTab({
  initialOperations,
  onSavePlatformSetting,
  refreshGlobalConfig,
}: OperationsSwitchesTabProps) {
  const { user } = useAuth();
  const [opsForm, setOpsForm] = useState<OperationsConfig>(() =>
    normalizeOperationsConfig(initialOperations)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [togglingSample, setTogglingSample] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setOpsForm(normalizeOperationsConfig(initialOperations));
    });
  }, [initialOperations]);

  const handleToggleHideSample = async () => {
    const nextVal = !opsForm.hide_sample_data;
    const nextOps: OperationsConfig = {
      ...opsForm,
      hide_sample_data: nextVal,
    };
    setOpsForm(nextOps);
    setTogglingSample(true);
    try {
      await updateHideSampleDataFlag(nextVal, user?.id);
      await onSavePlatformSetting(
        'operations_config',
        nextOps,
        nextVal
          ? 'Production Launch Mode enabled — [SAMPLE] records hidden globally.'
          : '[SAMPLE] demo records restored for testing.'
      );
      await refreshGlobalConfig();
    } finally {
      setTogglingSample(false);
    }
  };

  const handleSaveSwitches = async () => {
    setIsSaving(true);
    try {
      await updateHideSampleDataFlag(opsForm.hide_sample_data, user?.id);
      await onSavePlatformSetting(
        'operations_config',
        opsForm,
        'Operations & module kill switches saved.'
      );
      await refreshGlobalConfig();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Production Launch Switch */}
      <div
        className={`rounded-xl border p-4 shadow-sm transition ${
          opsForm.hide_sample_data
            ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30'
            : 'border-amber-300 bg-amber-50/60 dark:border-amber-800/70 dark:bg-amber-950/20'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              {opsForm.hide_sample_data ? (
                <Rocket className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <EyeOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Production Launch Switch: Hide [SAMPLE] Data
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {opsForm.hide_sample_data
                ? 'LIVE PRODUCTION MODE: All [SAMPLE] seed listings, vehicles, products, and bulletins are hidden across the app.'
                : 'DEMO / STAGING MODE: [SAMPLE] seed records are currently visible to help preview the app.'}
            </p>
          </div>

          <button
            type="button"
            disabled={togglingSample}
            onClick={() => void handleToggleHideSample()}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-60 ${
              opsForm.hide_sample_data
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-slate-900 hover:bg-slate-800 dark:bg-amber-600 dark:hover:bg-amber-500'
            }`}
          >
            {togglingSample ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {opsForm.hide_sample_data
              ? 'Production Mode: ON (Click to Show Samples)'
              : 'Enable Production Mode (Hide [SAMPLE])'}
          </button>
        </div>
      </div>

      {/* Per-Module Kill Switches */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              Module Kill Switches & Maintenance Notices
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Temporarily pause any module during maintenance or district
              outages with a custom user banner.
            </p>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveSwitches()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save All Switches
          </button>
        </div>

        <div className="space-y-2.5">
          {MODULE_META.map((mod) => {
            const sw = opsForm.module_switches[mod.key];
            return (
              <div
                key={mod.key}
                className={`rounded-lg border p-3 transition ${
                  sw.enabled
                    ? 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/50'
                    : 'border-rose-300 bg-rose-50/60 dark:border-rose-900/70 dark:bg-rose-950/20'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      {mod.title}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {mod.desc}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setOpsForm((prev) => ({
                        ...prev,
                        module_switches: {
                          ...prev.module_switches,
                          [mod.key]: {
                            ...prev.module_switches[mod.key],
                            enabled: !prev.module_switches[mod.key].enabled,
                          },
                        },
                      }))
                    }
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition ${
                      sw.enabled
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : 'bg-rose-600 text-white hover:bg-rose-700'
                    }`}
                  >
                    <Power className="h-3.5 w-3.5" />
                    {sw.enabled ? 'Live (Enabled)' : 'Paused (Kill Switch ON)'}
                  </button>
                </div>

                <div className="mt-2">
                  <input
                    type="text"
                    value={sw.pause_message}
                    onChange={(e) =>
                      setOpsForm((prev) => ({
                        ...prev,
                        module_switches: {
                          ...prev.module_switches,
                          [mod.key]: {
                            ...prev.module_switches[mod.key],
                            pause_message: e.target.value,
                          },
                        },
                      }))
                    }
                    placeholder={`Custom pause message when ${mod.title} is paused (optional)...`}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
