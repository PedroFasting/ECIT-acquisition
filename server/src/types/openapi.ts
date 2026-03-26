/**
 * Minimal OpenAPI 3.0 type definitions.
 * Just enough for our spec — avoids adding openapi-types as a dependency.
 */
export namespace OpenAPIV3 {
  export interface Document {
    openapi: string;
    info: InfoObject;
    servers?: ServerObject[];
    tags?: TagObject[];
    paths: Record<string, PathItemObject>;
    components?: ComponentsObject;
  }

  export interface InfoObject {
    title: string;
    version: string;
    description?: string;
  }

  export interface ServerObject {
    url: string;
    description?: string;
  }

  export interface TagObject {
    name: string;
    description?: string;
  }

  export interface PathItemObject {
    get?: OperationObject;
    post?: OperationObject;
    put?: OperationObject;
    delete?: OperationObject;
    patch?: OperationObject;
  }

  export interface OperationObject {
    tags?: string[];
    summary?: string;
    description?: string;
    security?: Record<string, string[]>[];
    parameters?: ParameterObject[];
    requestBody?: RequestBodyObject;
    responses: Record<string, ResponseObject>;
  }

  export interface ParameterObject {
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required?: boolean;
    schema: SchemaObject;
    description?: string;
  }

  export interface RequestBodyObject {
    required?: boolean;
    content: Record<string, MediaTypeObject>;
  }

  export interface ResponseObject {
    description: string;
    content?: Record<string, MediaTypeObject>;
  }

  export interface MediaTypeObject {
    schema?: SchemaObject | ReferenceObject;
  }

  export interface ReferenceObject {
    $ref: string;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface SchemaObject {
    [key: string]: unknown;
  }

  export interface SecuritySchemeObject {
    type: string;
    scheme?: string;
    bearerFormat?: string;
  }

  export interface ComponentsObject {
    securitySchemes?: Record<string, SecuritySchemeObject>;
    schemas?: Record<string, SchemaObject>;
  }
}
