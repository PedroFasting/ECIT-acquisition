import type {
  AuthResponse,
  Company,
  FinancialModel,
  AcquisitionScenario,
  ExcelImportResult,
  CompareResult,
  DealParameters,
  CalculatedReturn,
} from "../types";

const API_BASE = "/api";

class ApiService {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem("token");
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("token");
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || `API Error: ${res.status}`);
    }

    return res.json();
  }

  // Auth
  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async register(
    email: string,
    password: string,
    name: string
  ): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
    this.setToken(data.token);
    return data;
  }

  logout() {
    this.setToken(null);
  }

  // Companies
  async getCompanies(): Promise<Company[]> {
    return this.request("/companies");
  }

  async getCompany(id: number): Promise<Company> {
    return this.request(`/companies/${id}`);
  }

  async createCompany(data: Partial<Company>): Promise<Company> {
    return this.request("/companies", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCompany(id: number, data: Partial<Company>): Promise<Company> {
    return this.request(`/companies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteCompany(id: number): Promise<void> {
    return this.request(`/companies/${id}`, { method: "DELETE" });
  }

  // Models
  async getModels(companyId: number): Promise<FinancialModel[]> {
    return this.request(`/models/company/${companyId}`);
  }

  async getModel(id: number): Promise<FinancialModel> {
    return this.request(`/models/${id}`);
  }

  async createModel(data: {
    company_id: number;
    name: string;
    description?: string;
    model_type?: string;
  }): Promise<FinancialModel> {
    return this.request("/models", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateModel(
    id: number,
    data: Partial<FinancialModel>
  ): Promise<FinancialModel> {
    return this.request(`/models/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteModel(id: number): Promise<void> {
    return this.request(`/models/${id}`, { method: "DELETE" });
  }

  async upsertPeriods(
    modelId: number,
    periods: any[]
  ): Promise<{ count: number }> {
    return this.request(`/models/${modelId}/periods`, {
      method: "POST",
      body: JSON.stringify({ periods }),
    });
  }

  // Import
  async importJson(modelId: number, data: any): Promise<{ count: number }> {
    return this.request(`/import/json/${modelId}`, {
      method: "POST",
      body: JSON.stringify({ data }),
    });
  }

  async importJsonFile(
    modelId: number,
    file: File
  ): Promise<{ count: number }> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request(`/import/json/${modelId}`, {
      method: "POST",
      body: formData,
    });
  }

  async importCsvFile(
    modelId: number,
    file: File
  ): Promise<{ count: number }> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request(`/import/csv/${modelId}`, {
      method: "POST",
      body: formData,
    });
  }

  async importExcelFile(
    companyId: number,
    file: File
  ): Promise<ExcelImportResult> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request(`/import/excel/${companyId}`, {
      method: "POST",
      body: formData,
    });
  }

  // Scenarios
  async getScenarios(): Promise<AcquisitionScenario[]> {
    return this.request("/scenarios");
  }

  async compareModels(
    acquirerModelId: number,
    targetModelId?: number
  ): Promise<CompareResult> {
    const params = new URLSearchParams({
      acquirer_model_id: String(acquirerModelId),
    });
    if (targetModelId) {
      params.set("target_model_id", String(targetModelId));
    }
    return this.request(`/scenarios/compare?${params.toString()}`);
  }

  async getScenario(id: number): Promise<AcquisitionScenario> {
    return this.request(`/scenarios/${id}`);
  }

  async createScenario(
    data: Partial<AcquisitionScenario>
  ): Promise<AcquisitionScenario> {
    return this.request("/scenarios", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateScenario(
    id: number,
    data: Partial<AcquisitionScenario>
  ): Promise<AcquisitionScenario> {
    return this.request(`/scenarios/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteScenario(id: number): Promise<void> {
    return this.request(`/scenarios/${id}`, { method: "DELETE" });
  }

  async upsertDealReturns(
    scenarioId: number,
    returns: any[]
  ): Promise<{ count: number }> {
    return this.request(`/scenarios/${scenarioId}/returns`, {
      method: "POST",
      body: JSON.stringify({ returns }),
    });
  }

  async generateProForma(
    scenarioId: number
  ): Promise<{ count: number }> {
    return this.request(`/scenarios/${scenarioId}/generate-pro-forma`, {
      method: "POST",
    });
  }

  async calculateReturns(
    scenarioId: number,
    dealParameters: DealParameters
  ): Promise<{ calculated_returns: CalculatedReturn[]; standalone_by_multiple: Record<number, { irr: number | null; mom: number | null }>; deal_parameters: DealParameters }> {
    return this.request(`/scenarios/${scenarioId}/calculate-returns`, {
      method: "POST",
      body: JSON.stringify({ deal_parameters: dealParameters }),
    });
  }
}

export const api = new ApiService();
export default api;
