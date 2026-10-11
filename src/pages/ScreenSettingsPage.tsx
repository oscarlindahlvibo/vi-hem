import React, { useEffect, useRef, useState } from "react";
import {
  Copy,
  Link2,
  Monitor,
  Plus,
  Power,
  Save,
  Settings,
  Trash2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  Button,
  Card,
  EmptyState,
  Input,
  LoadingPage,
  Modal,
  PageHeader,
  Select,
  Tabs,
} from "../components/ui";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges";
import type { LaundryRoom, Meeting } from "../types";
import {
  buildOrganisationScreenSettings,
  DEFAULT_SCREEN_KEY,
  defaultScreenConfig,
  isMissingScreenSettingsTable,
  mergeScreenConfigs,
  normalizePresentationSettings,
  normalizeScreenConfig,
  readOrganisationScreenConfigs,
  screenViewLabel,
  type MeetingScreenPart,
  type PresentationSettings,
  type ScreenConfig,
  type ScreenView,
} from "../lib/screenSettings";

interface ScreenSettingsPageProps {
  onNavigate: (page: string) => void;
}

// A screen access link (vihem_screen_tokens) lets a TV log in as an
// existing role='screen' account without typing its password on the
// device -- see vihem-screen-session and ScreenDisplayPage.tsx.
type ScreenAccessToken = {
  id: string;
  profile_id: string;
  token: string;
  label: string;
  active: boolean;
  last_used_at: string | null;
  created_at: string;
};
type ScreenProfile = { id: string; name: string; email: string };

const panelOptions: Array<{
  key: keyof PresentationSettings;
  label: string;
  description: string;
}> = [
  {
    key: "showNews",
    label: "Nyheter",
    description: "Visar publicerade nyheter i presentationsvyn.",
  },
  {
    key: "showWorkOrders",
    label: "Arbetsordrar",
    description:
      "Visar aktiva arbetsordrar sorterade efter förfallodag och prioritet.",
  },
  {
    key: "showClockedIn",
    label: "Instämplad personal",
    description: "Visar vilka som är instämplade just nu.",
  },
  {
    key: "showMeetings",
    label: "Kalenderhändelser",
    description: "Visar kommande möten och uppföljningar.",
  },
];

const tickerOptions: Array<{ key: keyof PresentationSettings; label: string }> =
  [
    { key: "showTickerWeather", label: "Väder" },
    { key: "showTickerCheckIns", label: "Incheckningar idag" },
    { key: "showTickerCheckOuts", label: "Utcheckningar idag" },
    { key: "showTickerClockedIn", label: "Instämplade just nu" },
    { key: "showTickerUpdated", label: "Senast uppdaterad" },
  ];

export function ScreenSettingsPage({
  onNavigate: _onNavigate,
}: ScreenSettingsPageProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [screens, setScreens] = useState<ScreenConfig[]>(() => [
    defaultScreenConfig(1),
  ]);
  const [selectedScreenKey, setSelectedScreenKey] =
    useState(DEFAULT_SCREEN_KEY);
  const [organisationSettings, setOrganisationSettings] = useState<
    Record<string, unknown>
  >({});
  const [laundryRooms, setLaundryRooms] = useState<LaundryRoom[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [screenProfiles, setScreenProfiles] = useState<ScreenProfile[]>([]);
  const [screenTokens, setScreenTokens] = useState<ScreenAccessToken[]>([]);
  const [newTokenProfileId, setNewTokenProfileId] = useState("");
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [section, setSection] = useState("screen");
  const [editorSection, setEditorSection] = useState("profile");
  const [loaded, setLoaded] = useState(false);
  const [dataOrganisation, setDataOrganisation] = useState("");
  const currentOrganisation = useRef(user?.organisation_id);
  currentOrganisation.current = user?.organisation_id;
  const [savedScreens, setSavedScreens] = useState<ScreenConfig[]>([]);
  const [pendingDelete, setPendingDelete] = useState<ScreenAccessToken | null>(
    null,
  );
  const [tokenBusy, setTokenBusy] = useState<string | null>(null);
  const saveLock = useRef(false);
  const tokenLock = useRef(false);
  const dirty = useUnsavedChanges(screens, loaded, savedScreens);

  const canManage = user?.role === "admin" || user?.role === "superadmin";
  const selectedScreen =
    screens.find((screen) => screen.screenKey === selectedScreenKey) ||
    screens[0] ||
    defaultScreenConfig(1);
  const screenView = selectedScreen.screenView;
  const settings = selectedScreen.presentationSettings;

  useEffect(() => {
    setScreenTokens([]);
    setScreenProfiles([]);
    setNewTokenProfileId("");
    setScreens([defaultScreenConfig(1)]);
    setSavedScreens([]);
    setOrganisationSettings({});
    void fetchSettings();
    void fetchScreenAccess();
  }, [user?.organisation_id]);

  async function fetchScreenAccess() {
    if (!canManage || !user?.organisation_id) return;
    const organisation = user.organisation_id;
    try {
      const [profilesResult, tokensResult] = await Promise.all([
        supabase
          .from("vihem_profiles")
          .select("id,name,email")
          .eq("organisation_id", user.organisation_id)
          .eq("role", "screen")
          .order("name"),
        supabase
          .from("vihem_screen_tokens")
          .select("id,profile_id,token,label,active,last_used_at,created_at")
          .eq("organisation_id", user.organisation_id)
          .order("created_at", { ascending: false }),
      ]);
      if (currentOrganisation.current !== organisation) return;
      if (profilesResult.error || tokensResult.error)
        setError("Skärmlänkar kunde inte hämtas. Försök läsa in dem igen.");
      if (!profilesResult.error)
        setScreenProfiles((profilesResult.data || []) as ScreenProfile[]);
      if (!tokensResult.error)
        setScreenTokens((tokensResult.data || []) as ScreenAccessToken[]);
    } catch {
      setError("Skärmlänkar kunde inte hämtas. Försök igen.");
    }
  }

  function screenTokenUrl(tokenRow: Pick<ScreenAccessToken, "token">) {
    return `${window.location.origin}/screen?screen_token=${encodeURIComponent(tokenRow.token)}`;
  }

  async function copyScreenTokenLink(tokenRow: ScreenAccessToken) {
    try {
      await navigator.clipboard.writeText(screenTokenUrl(tokenRow));
      setSuccess("Länken kopierades.");
      setTimeout(() => setSuccess(""), 2000);
    } catch {
      setError("Kunde inte kopiera länken. Kopiera den manuellt istället.");
    }
  }

  async function createScreenToken() {
    if (!canManage || !user?.organisation_id || tokenLock.current) return;
    const profileId = newTokenProfileId || screenProfiles[0]?.id;
    if (!profileId) {
      setError("Skapa först ett konto med rollen Skärm.");
      return;
    }
    tokenLock.current = true;
    setCreatingToken(true);
    setError("");
    setSuccess("");
    try {
      const { data, error } = await supabase
        .from("vihem_screen_tokens")
        .insert({
          organisation_id: user.organisation_id,
          profile_id: profileId,
          label: newTokenLabel.trim(),
          created_by: user.id,
        })
        .select("id,profile_id,token,label,active,last_used_at,created_at")
        .single();
      if (error) throw error;
      setScreenTokens((current) => [data as ScreenAccessToken, ...current]);
      setNewTokenLabel("");
      setSuccess(
        "Länken är skapad. Välj Kopiera länk för att använda den på TV:n.",
      );
    } catch (failure) {
      setError(
        (failure as Error).message ||
          "Länken kunde inte skapas. Kontrollera listan innan du försöker igen.",
      );
    } finally {
      tokenLock.current = false;
      setCreatingToken(false);
    }
  }

  async function toggleScreenToken(tokenRow: ScreenAccessToken) {
    if (!canManage || tokenLock.current || !user?.organisation_id) return;
    tokenLock.current = true;
    setTokenBusy(tokenRow.id);
    setError("");
    try {
      const { data, error } = await supabase
        .from("vihem_screen_tokens")
        .update({ active: !tokenRow.active })
        .eq("organisation_id", user.organisation_id)
        .eq("id", tokenRow.id)
        .select("id,profile_id,token,label,active,last_used_at,created_at")
        .single();
      if (error) throw error;
      setScreenTokens((current) =>
        current.map((item) =>
          item.id === tokenRow.id ? (data as ScreenAccessToken) : item,
        ),
      );
    } catch (failure) {
      setError(
        (failure as Error).message ||
          "Länken kunde inte uppdateras. Läs in listan igen.",
      );
    } finally {
      tokenLock.current = false;
      setTokenBusy(null);
    }
  }

  async function deleteScreenToken(tokenRow: ScreenAccessToken) {
    if (!canManage || tokenLock.current || !user?.organisation_id) return;
    tokenLock.current = true;
    setTokenBusy(tokenRow.id);
    setError("");
    try {
      const { data, error } = await supabase
        .from("vihem_screen_tokens")
        .delete()
        .eq("organisation_id", user.organisation_id)
        .eq("id", tokenRow.id)
        .select("id");
      if (error) throw error;
      if (!data?.length)
        throw new Error("Länken kunde inte tas bort. Läs in listan igen.");
      setScreenTokens((current) =>
        current.filter((item) => item.id !== tokenRow.id),
      );
      setPendingDelete(null);
      setSuccess("Länken är borttagen.");
    } catch (failure) {
      setError((failure as Error).message || "Länken kunde inte tas bort.");
    } finally {
      tokenLock.current = false;
      setTokenBusy(null);
    }
  }

  async function fetchSettings() {
    if (!user?.organisation_id) {
      setLoading(false);
      return;
    }

    const organisation = user.organisation_id;
    setDataOrganisation(organisation);
    setLoaded(false);
    setLoading(true);
    setError("");

    try {
      const [
        screenSettingsResult,
        organisationResult,
        laundryRoomsResult,
        meetingsResult,
      ] = await Promise.all([
        supabase
          .from("vihem_screen_settings")
          .select("screen_key, screen_view, presentation_settings")
          .eq("organisation_id", user.organisation_id)
          .order("screen_key"),
        supabase
          .from("vihem_organisations")
          .select("settings")
          .eq("id", user.organisation_id)
          .maybeSingle(),
        supabase
          .from("vihem_laundry_rooms")
          .select("*, property:vihem_properties(name)")
          .eq("organisation_id", user.organisation_id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("vihem_meetings")
          .select(
            "id, title, meeting_type, status, starts_at, ends_at, location",
          )
          .eq("organisation_id", user.organisation_id)
          .in("status", ["draft", "planned", "in_progress"])
          .order("starts_at", { ascending: true, nullsFirst: false })
          .limit(80),
      ]);

      const screenSettingsUnavailable = isMissingScreenSettingsTable(
        screenSettingsResult.error,
      );

      if (currentOrganisation.current !== organisation) return;
      if (
        organisationResult.data?.settings &&
        typeof organisationResult.data.settings === "object"
      ) {
        setOrganisationSettings(
          organisationResult.data.settings as Record<string, unknown>,
        );
      }

      if (!laundryRoomsResult.error) {
        setLaundryRooms((laundryRoomsResult.data || []) as LaundryRoom[]);
      }

      if (!meetingsResult.error) {
        setMeetings((meetingsResult.data || []) as Meeting[]);
      }

      if (screenSettingsResult.error && !screenSettingsUnavailable) {
        setError(screenSettingsResult.error.message);
      } else if (organisationResult.error) {
        setError(organisationResult.error.message);
      } else if (laundryRoomsResult.error) {
        setError(laundryRoomsResult.error.message);
      } else if (meetingsResult.error) {
        setError(meetingsResult.error.message);
      } else if (screenSettingsResult.data?.length) {
        const dbScreens = screenSettingsResult.data.map(
          (row: any, index: number) => normalizeScreenConfig(row, index + 1),
        );
        const fallbackScreens = readOrganisationScreenConfigs(
          organisationResult.data?.settings,
        );
        const nextScreens = mergeScreenConfigs(fallbackScreens, dbScreens);
        setScreens(nextScreens);
        setSavedScreens(nextScreens);
        setSelectedScreenKey((current) =>
          nextScreens.some((screen) => screen.screenKey === current)
            ? current
            : nextScreens[0].screenKey,
        );
      } else {
        const fallbackScreens = readOrganisationScreenConfigs(
          organisationResult.data?.settings,
        );
        if (fallbackScreens.length > 0) {
          setScreens(fallbackScreens);
          setSavedScreens(fallbackScreens);
          setSelectedScreenKey((current) =>
            fallbackScreens.some((screen) => screen.screenKey === current)
              ? current
              : fallbackScreens[0].screenKey,
          );
        } else {
          setSavedScreens([defaultScreenConfig(1)]);
        }
      }
      setLoaded(
        !(
          (screenSettingsResult.error && !screenSettingsUnavailable) ||
          organisationResult.error ||
          laundryRoomsResult.error ||
          meetingsResult.error
        ) && Boolean(organisationResult.data),
      );
    } catch {
      setError("Kunde inte läsa inställningarna. Försök igen.");
    } finally {
      if (currentOrganisation.current === organisation) setLoading(false);
    }
  }

  function updateSetting<K extends keyof PresentationSettings>(
    key: K,
    value: PresentationSettings[K],
  ) {
    updateSelectedScreen({
      presentationSettings: { ...settings, [key]: value },
    });
  }

  function updateTickerItem(index: number, value: string) {
    const nextItems = [...settings.customTickerItems];
    nextItems[index] = value;
    updateSetting("customTickerItems", nextItems);
  }

  function updateSelectedScreen(updates: Partial<ScreenConfig>) {
    setScreens((prev) =>
      prev.map((screen) =>
        screen.screenKey === selectedScreen.screenKey
          ? { ...screen, ...updates }
          : screen,
      ),
    );
  }

  function addScreen() {
    setError("");
    setSuccess("");
    const nextNumber = screens.length + 1;
    let nextScreen = defaultScreenConfig(nextNumber);
    while (
      screens.some((screen) => screen.screenKey === nextScreen.screenKey)
    ) {
      nextScreen = defaultScreenConfig(
        nextNumber + Math.floor(Math.random() * 1000),
      );
    }
    setScreens((prev) => [...prev, nextScreen]);
    setSelectedScreenKey(nextScreen.screenKey);
  }

  function deleteSelectedScreen() {
    if (screens.length <= 1) {
      setError("Det måste finnas minst en skärm.");
      return;
    }

    setScreens((prev) => {
      const nextScreens = prev.filter(
        (screen) => screen.screenKey !== selectedScreen.screenKey,
      );
      setSelectedScreenKey(nextScreens[0]?.screenKey || DEFAULT_SCREEN_KEY);
      return nextScreens;
    });
  }

  async function saveSettings() {
    if (!user?.organisation_id || !canManage) return;

    if (saveLock.current || !loaded) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    setSuccess("");

    const cleanedScreens = screens.map((screen) => ({
      ...screen,
      name: screen.name.trim() || screen.screenKey,
      presentationSettings: {
        ...screen.presentationSettings,
        customTickerText: "",
        customTickerItems: screen.presentationSettings.customTickerItems
          .map((item) => item.trim())
          .filter(Boolean),
      },
      laundryRoomId: screen.laundryRoomId || "",
      meetingId: screen.meetingId || "",
      meetingPart: screen.meetingPart || "full",
    }));

    try {
      const next = buildOrganisationScreenSettings(
        {},
        cleanedScreens,
      ).screen_settings;
      const result = await supabase.rpc("vihem_save_screen_settings", {
        p_settings: next,
        p_expected: organisationSettings.screen_settings || null,
      });
      if (result.error) throw result.error;
      setOrganisationSettings(result.data as Record<string, unknown>);
      setScreens(cleanedScreens);
      setSavedScreens(cleanedScreens);
      setSuccess(
        "Alla skärminställningar är sparade. Skärmarna hämtar dem automatiskt.",
      );
    } catch (failure) {
      const code = (failure as { code?: string }).code;
      setError(
        code === "PT409" || code === "40001"
          ? "Inställningarna har ändrats av någon annan. Dina ändringar finns kvar. Läs in den senaste versionen innan du sparar igen."
          : code === "PGRST202"
            ? "Serverns nya sparfunktion saknas. Installera skärmmigrationen innan dessa ändringar sparas."
            : (failure as { message?: string }).message ||
              "Kunde inte spara. Dina ändringar finns kvar.",
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={Monitor}
        title="Endast admin kan ändra TV-skärmen"
        description="Be en administratör öppna den här sidan för att styra presentationsvyn."
      />
    );
  }

  if (loading || dataOrganisation !== user?.organisation_id)
    return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="TV-skärm"
        subtitle="Styr vad organisationens presentationsskärm visar utan att behöva skriva eller ändra något direkt på TV:n."
        icon={Monitor}
        action={
          <Button
            onClick={saveSettings}
            loading={saving}
            disabled={!loaded || !dirty}
          >
            <Save className="h-4 w-4" />
            Spara
          </Button>
        }
      />

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"
        >
          {success}
        </div>
      )}

      {!loaded && (
        <Button variant="secondary" onClick={() => void fetchSettings()}>
          Försök läsa in igen
        </Button>
      )}
      <Tabs
        tabs={[
          { key: "screen", label: "Skärmar och innehåll" },
          { key: "access", label: "Åtkomstlänkar" },
        ]}
        active={section}
        onChange={setSection}
      />
      <fieldset
        disabled={saving || !loaded}
        className={section === "screen" ? "mt-5 min-w-0" : "hidden"}
      >
        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <div className="space-y-5">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">
                  Skärmar
                </h2>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={addScreen}
                >
                  <Plus className="h-4 w-4" />
                  Lägg till
                </Button>
              </div>
              <div className="space-y-2">
                {screens.map((screen) => (
                  <button
                    key={screen.screenKey}
                    type="button"
                    aria-pressed={selectedScreen.screenKey === screen.screenKey}
                    onClick={() => setSelectedScreenKey(screen.screenKey)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      selectedScreen.screenKey === screen.screenKey
                        ? "border-blue-300 bg-blue-50 text-blue-800 ring-1 ring-blue-100"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {screen.name}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold text-slate-500">
                        {screenViewLabel(screen.screenView)}
                      </span>
                    </span>
                    <Monitor
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 text-slate-400"
                    />
                  </button>
                ))}
              </div>
            </Card>
          </div>
          <div className="min-w-0 space-y-5">
            {screenView === "presentation" && (
              <Tabs
                tabs={[
                  { key: "profile", label: "Skärmprofil" },
                  { key: "content", label: "Paneler och banner" },
                ]}
                active={editorSection}
                onChange={setEditorSection}
              />
            )}
            <Card
              className={
                screenView !== "presentation" || editorSection === "profile"
                  ? "p-5"
                  : "hidden"
              }
            >
              <div className="mb-4 flex items-center gap-2">
                <Settings className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-slate-950">
                  {selectedScreen.name}
                </h2>
              </div>
              <Input
                label="Namn"
                value={selectedScreen.name}
                onChange={(event) =>
                  updateSelectedScreen({ name: event.target.value })
                }
                placeholder="Ex. Reception"
              />
              <div className="mt-4">
                <Select
                  label="Vad ska TV:n visa?"
                  value={screenView}
                  onChange={(event) =>
                    updateSelectedScreen({
                      screenView: event.target.value as ScreenView,
                    })
                  }
                  options={[
                    {
                      value: "presentation",
                      label: screenViewLabel("presentation"),
                    },
                    {
                      value: "short-stay",
                      label: screenViewLabel("short-stay"),
                    },
                    {
                      value: "work-orders",
                      label: screenViewLabel("work-orders"),
                    },
                    { value: "meeting", label: screenViewLabel("meeting") },
                    { value: "laundry", label: screenViewLabel("laundry") },
                  ]}
                />
              </div>
              {screenView === "laundry" && (
                <div className="mt-4">
                  <Select
                    label="Tvättstuga"
                    value={selectedScreen.laundryRoomId || ""}
                    onChange={(event) =>
                      updateSelectedScreen({
                        laundryRoomId: event.target.value,
                      })
                    }
                    options={[
                      { value: "", label: "Välj tvättstuga" },
                      ...laundryRooms.map((room) => ({
                        value: room.id,
                        label: `${room.name}${room.property?.name ? ` · ${room.property.name}` : ""}`,
                      })),
                    ]}
                  />
                </div>
              )}
              {screenView === "meeting" && (
                <div className="mt-4 grid gap-4">
                  <Select
                    label="Möte"
                    value={selectedScreen.meetingId || ""}
                    onChange={(event) =>
                      updateSelectedScreen({ meetingId: event.target.value })
                    }
                    options={[
                      {
                        value: "",
                        label: "Välj automatiskt aktivt/kommande möte",
                      },
                      ...meetings.map((meeting) => ({
                        value: meeting.id,
                        label: `${meeting.title}${meeting.starts_at ? ` · ${new Date(meeting.starts_at).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}` : ""}`,
                      })),
                    ]}
                  />
                  <Select
                    label="Del som ska visas"
                    value={selectedScreen.meetingPart || "full"}
                    onChange={(event) =>
                      updateSelectedScreen({
                        meetingPart: event.target.value as MeetingScreenPart,
                      })
                    }
                    options={[
                      { value: "full", label: "Hela mötet på en skärm" },
                      {
                        value: "part-1",
                        label: "Del 1/2: dagordning och arbetsordrar",
                      },
                      {
                        value: "part-2",
                        label: "Del 2/2: kundprojekt, frånvaro och kommande",
                      },
                    ]}
                    hint="Använd två olika skärmprofiler om mötet ska delas över två TV-skärmar."
                  />
                </div>
              )}
              <p className="mt-3 text-sm leading-6 text-slate-500">
                När TV:n har valts som{" "}
                {selectedScreen.name || selectedScreen.screenKey} hämtar den den
                här profilen automatiskt.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={deleteSelectedScreen}
                disabled={screens.length <= 1}
              >
                <Trash2 className="h-4 w-4" />
                Ta bort vald skärm
              </Button>
            </Card>

            <Card
              className={
                screenView === "presentation" && editorSection === "content"
                  ? "p-5"
                  : "hidden"
              }
            >
              <h2 className="mb-4 text-lg font-semibold text-slate-950">
                Väder
              </h2>
              <Input
                label="Plats"
                value={settings.weatherLocation}
                onChange={(event) =>
                  updateSetting("weatherLocation", event.target.value)
                }
                placeholder="Ex. Virserum"
                hint="Används både i väderboxen och i rullande bannern om väder är valt."
              />
            </Card>
            <div
              className={
                screenView === "presentation" && editorSection === "content"
                  ? "space-y-5"
                  : "hidden"
              }
            >
              <Card className="p-5">
                <h2 className="mb-4 text-lg font-semibold text-slate-950">
                  Paneler i presentationsvyn
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {panelOptions.map((option) => (
                    <label
                      key={option.key}
                      className="flex min-w-0 gap-3 border-b border-slate-100 py-4"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(settings[option.key])}
                        onChange={(event) =>
                          updateSetting(
                            option.key,
                            event.target.checked as never,
                          )
                        }
                        className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-600"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-900">
                          {option.label}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-slate-500">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-4 text-lg font-semibold text-slate-950">
                  Rullande banner
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tickerOptions.map((option) => (
                    <label
                      key={option.key}
                      className="flex items-center gap-3 py-3 text-sm font-medium text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(settings[option.key])}
                        onChange={(event) =>
                          updateSetting(
                            option.key,
                            event.target.checked as never,
                          )
                        }
                        className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        Egna texter
                      </h3>
                      <p className="text-sm text-slate-500">
                        Skriv flera punkter som ska rulla tillsammans med valda
                        automatiska värden.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        updateSetting("customTickerItems", [
                          ...settings.customTickerItems,
                          "",
                        ])
                      }
                    >
                      <Plus className="h-4 w-4" />
                      Lägg till
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {settings.customTickerItems.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
                        Inga egna texter ännu.
                      </div>
                    )}

                    {settings.customTickerItems.map((item, index) => (
                      <div key={index} className="flex min-w-0 gap-2">
                        <Input
                          aria-label={`Bannertext ${index + 1}`}
                          value={item}
                          onChange={(event) =>
                            updateTickerItem(index, event.target.value)
                          }
                          placeholder="Ex. Välkommen till VI-HEM"
                          className="min-w-0"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            updateSetting(
                              "customTickerItems",
                              settings.customTickerItems.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                          className="self-start"
                          aria-label="Ta bort text"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </fieldset>
      {section === "screen" && (
        <div className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <p role="status" className="text-sm text-slate-500">
            {dirty ? "Osparade ändringar" : "Inga osparade ändringar"}
          </p>
          <Button
            onClick={saveSettings}
            loading={saving}
            disabled={!loaded || !dirty}
          >
            <Save className="h-4 w-4" />
            Spara skärminställningar
          </Button>
        </div>
      )}
      <Card className={section === "access" ? "mt-5 p-5" : "hidden"}>
        <div className="mb-1 flex items-center gap-2">
          <Link2 className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-950">
            Länkar till TV-skärmar
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void fetchScreenAccess()}
          >
            Läs in igen
          </Button>
        </div>
        <p className="mb-4 text-sm leading-6 text-slate-500">
          Ge en TV en egen länk istället för att skriva in skärmkontots lösenord
          på plats. Länken loggar in TV:n automatiskt och kan återkallas när som
          helst, utan att lösenordet behöver bytas.
        </p>

        {screenProfiles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
            Det finns inget skärmkonto ännu. Skapa ett under Personal med rollen
            "Skärm" innan du kan skapa en länk.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {screenProfiles.length > 1 && (
                <Select
                  label="Skärmkonto"
                  value={newTokenProfileId || screenProfiles[0].id}
                  onChange={(event) => setNewTokenProfileId(event.target.value)}
                  options={screenProfiles.map((profile) => ({
                    value: profile.id,
                    label: profile.name || profile.email,
                  }))}
                />
              )}
              <Input
                label="Namn på länken (valfritt)"
                value={newTokenLabel}
                onChange={(event) => setNewTokenLabel(event.target.value)}
                placeholder="Ex. TV i tvättstugan"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={createScreenToken}
                loading={creatingToken}
                disabled={Boolean(tokenBusy)}
              >
                <Plus className="h-4 w-4" />
                Skapa länk
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {screenTokens.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
                  Inga länkar skapade ännu.
                </div>
              ) : (
                screenTokens.map((tokenRow) => (
                  <div
                    key={tokenRow.id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {tokenRow.label || "Namnlös länk"}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {tokenRow.active ? "Aktiv" : "Inaktiverad"} · Skapad{" "}
                        {new Date(tokenRow.created_at).toLocaleDateString(
                          "sv-SE",
                        )}
                        {tokenRow.last_used_at
                          ? ` · Senast använd ${new Date(tokenRow.last_used_at).toLocaleDateString("sv-SE")}`
                          : " · Aldrig använd"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => copyScreenTokenLink(tokenRow)}
                      >
                        <Copy className="h-4 w-4" />
                        Kopiera länk
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(tokenBusy) || creatingToken}
                        loading={tokenBusy === tokenRow.id}
                        onClick={() => toggleScreenToken(tokenRow)}
                      >
                        <Power className="h-4 w-4" />
                        {tokenRow.active ? "Inaktivera" : "Aktivera"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(tokenBusy) || creatingToken}
                        onClick={() => setPendingDelete(tokenRow)}
                        aria-label="Ta bort länk"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </Card>
      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          if (!tokenBusy) setPendingDelete(null);
        }}
        title="Ta bort skärmlänk?"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={Boolean(tokenBusy)}
              onClick={() => setPendingDelete(null)}
            >
              Avbryt
            </Button>
            <Button
              variant="danger"
              loading={Boolean(tokenBusy)}
              onClick={() =>
                pendingDelete && void deleteScreenToken(pendingDelete)
              }
            >
              Ta bort länken
            </Button>
          </>
        }
      >
        <p>
          Länken {pendingDelete?.label || "till TV-skärmen"} kan inte längre
          användas för nya inloggningar. En redan inloggad skärms session
          avslutas inte av detta.
        </p>
      </Modal>
    </div>
  );
}
